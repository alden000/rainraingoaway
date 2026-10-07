/**
 * Echo tracking. Estimates how rain is moving by block-matching successive
 * radar scans (a lightweight cousin of the TREC / optical-flow trackers used
 * in operational nowcasting systems).
 *
 *  1. Scans are reduced to an intensity field and down-sampled into a pyramid.
 *  2. A domain-wide shift is found first (robust "steering" estimate).
 *  3. Each block then searches around that shift for its local vector,
 *     and is refined at full resolution with sub-pixel interpolation.
 *  4. Outliers are rejected, gaps filled, and the field smoothed.
 */
import { FRAME_MS } from '../config';
import { kmPerPixel } from './frameMath';
import type { MotionField, RadarFrame } from './types';

const MAX_SPEED_KMH = 100;
const BLOCK_NATIVE = 24; // block grid step in native pixels

interface Pyr {
  w: number;
  h: number;
  d: Float32Array;
}

function intensity(frame: RadarFrame, clutter: Uint8Array | null): Pyr {
  const { width: w, height: h, levels } = frame;
  const d = new Float32Array(w * h);
  for (let i = 0; i < d.length; i++) {
    const l = levels[i];
    d[i] = l > 0 && !(clutter && clutter[i]) ? 0.3 + (0.7 * l) / 33 : 0;
  }
  return { w, h, d };
}

function down(p: Pyr): Pyr {
  const w = p.w >> 1;
  const h = p.h >> 1;
  const d = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = 2 * y * p.w + 2 * x;
      d[y * w + x] = 0.25 * (p.d[i] + p.d[i + 1] + p.d[i + p.w] + p.d[i + p.w + 1]);
    }
  }
  return { w, h, d };
}

/** Mean absolute difference between A[window] and B[window + (dx,dy)]. */
function sad(A: Pyr, B: Pyr, x0: number, y0: number, x1: number, y1: number, dx: number, dy: number): number {
  let acc = 0;
  let n = 0;
  const w = A.w;
  const ya = Math.max(y0, -dy);
  const yb = Math.min(y1, A.h - dy);
  const xa = Math.max(x0, -dx);
  const xb = Math.min(x1, A.w - dx);
  for (let y = ya; y < yb; y++) {
    let ia = y * w + xa;
    let ib = (y + dy) * w + xa + dx;
    for (let x = xa; x < xb; x++, ia++, ib++) {
      const a = A.d[ia];
      const b = B.d[ib];
      if (a === 0 && b === 0) {
        n++;
        continue;
      }
      acc += a > b ? a - b : b - a;
      n++;
    }
  }
  const area = (x1 - x0) * (y1 - y0);
  // Require meaningful overlap; heavily penalise shifts that push the window off-image.
  return n < area * 0.5 ? Infinity : acc / n;
}

function rainFraction(P: Pyr, x0: number, y0: number, x1: number, y1: number): number {
  let r = 0;
  let n = 0;
  for (let y = Math.max(0, y0); y < Math.min(P.h, y1); y++) {
    for (let x = Math.max(0, x0); x < Math.min(P.w, x1); x++) {
      n++;
      if (P.d[y * P.w + x] > 0) r++;
    }
  }
  return n ? r / n : 0;
}

interface Pair {
  A: Pyr[];
  B: Pyr[];
  steps: number; // 5-minute steps between A and B
}

function pairCost(pairs: Pair[], lvl: number, x0: number, y0: number, x1: number, y1: number, dx: number, dy: number) {
  let c = 0;
  for (const p of pairs) {
    const s = sad(p.A[lvl], p.B[lvl], x0, y0, x1, y1, dx, dy);
    if (!isFinite(s)) return Infinity;
    c += s;
  }
  return c / pairs.length;
}

/** Parabolic sub-pixel offset from three cost samples around a minimum. */
function subpixel(cm: number, c0: number, cp: number): number {
  const den = cm - 2 * c0 + cp;
  if (!isFinite(den) || den <= 1e-9) return 0;
  return Math.max(-0.5, Math.min(0.5, (0.5 * (cm - cp)) / den));
}

function pickFrame(frames: RadarFrame[], target: number): RadarFrame | null {
  let best: RadarFrame | null = null;
  let bestDt = Infinity;
  for (const f of frames) {
    const dt = Math.abs(f.time - target);
    if (dt < bestDt) {
      bestDt = dt;
      best = f;
    }
  }
  return best && bestDt <= FRAME_MS * 0.6 ? best : null;
}

function weightedMedian(values: number[], weights: number[]): number {
  const idx = values.map((_, i) => i).sort((a, b) => values[a] - values[b]);
  const total = weights.reduce((s, w) => s + w, 0);
  let acc = 0;
  for (const i of idx) {
    acc += weights[i];
    if (acc >= total / 2) return values[i];
  }
  return values[idx[idx.length - 1]] ?? 0;
}

/**
 * @param frames chronologically sorted scans of one range
 * @param clutter optional stationary-echo mask (1 = ignore)
 */
export function estimateMotion(frames: RadarFrame[], clutter: Uint8Array | null): MotionField | null {
  if (frames.length < 2) return null;
  const latest = frames[frames.length - 1];
  const { width: W, height: H, range } = latest;

  // Baselines: 15 min, plus the preceding 15 min if available. Fall back to
  // whatever spacing exists (≥ 5 min).
  const built: Pair[] = [];
  const cache = new Map<RadarFrame, Pyr[]>();
  const pyr = (f: RadarFrame) => {
    let p = cache.get(f);
    if (!p) {
      const l0 = intensity(f, clutter);
      const l1 = down(l0);
      const l2 = down(l1);
      p = [l0, l1, l2];
      cache.set(f, p);
    }
    return p;
  };
  const tryPair = (endTime: number, gapSteps: number) => {
    const b = pickFrame(frames, endTime);
    const a = pickFrame(frames, endTime - gapSteps * FRAME_MS);
    if (!a || !b || a === b) return false;
    const steps = Math.round((b.time - a.time) / FRAME_MS);
    if (steps < 1) return false;
    built.push({ A: pyr(a), B: pyr(b), steps });
    return true;
  };
  if (tryPair(latest.time, 3)) {
    tryPair(latest.time - 3 * FRAME_MS, 3);
  } else {
    const prev = frames[frames.length - 2];
    const steps = Math.max(1, Math.round((latest.time - prev.time) / FRAME_MS));
    built.push({ A: pyr(prev), B: pyr(latest), steps });
  }
  // All pairs must share a baseline for their costs to be comparable.
  const steps = built[0].steps;
  const pairs = built.filter((p) => p.steps === steps);

  const { kx } = kmPerPixel(range, W);
  const maxNative = (MAX_SPEED_KMH / 12) * steps / kx; // px over the baseline
  const L2 = pairs[0].A[2];
  const L1 = pairs[0].A[1];
  const R2 = Math.max(3, Math.ceil(maxNative / 4));

  // ---- 1. Global shift on level 2 -------------------------------------
  const rainAny = rainFraction(pairs[0].B[2], 0, 0, L2.w, L2.h);
  const cols = Math.round(W / BLOCK_NATIVE);
  const rows = Math.round(H / BLOCK_NATIVE);
  const n = cols * rows;
  const u = new Float32Array(n);
  const v = new Float32Array(n);
  const valid = new Uint8Array(n);
  const empty: MotionField = {
    range, cols, rows, step: BLOCK_NATIVE, width: W, height: H, u, v, valid,
    globalU: 0, globalV: 0, confidence: 0, coverage: 0
  };
  if (rainAny < 0.002) return empty;

  let gdx = 0;
  let gdy = 0;
  let gBest = Infinity;
  for (let dy = -R2; dy <= R2; dy++) {
    for (let dx = -R2; dx <= R2; dx++) {
      if (dx * dx + dy * dy > R2 * R2) continue;
      const c = pairCost(pairs, 2, 0, 0, L2.w, L2.h, dx, dy);
      if (c < gBest) {
        gBest = c;
        gdx = dx;
        gdy = dy;
      }
    }
  }

  // ---- 2. Block search --------------------------------------------------
  const LOCAL = 5; // level-2 search radius around the global shift
  const fractions: number[] = [];
  const blockIdx: number[] = [];
  const bu: number[] = [];
  const bv: number[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      // Window on level 1 (half resolution): centred on block, 2× block size for context.
      const cx1 = ((c + 0.5) * BLOCK_NATIVE) / 2;
      const cy1 = ((r + 0.5) * BLOCK_NATIVE) / 2;
      const half1 = BLOCK_NATIVE / 2 + 6;
      const x0 = Math.max(0, Math.round(cx1 - half1));
      const y0 = Math.max(0, Math.round(cy1 - half1));
      const x1 = Math.min(L1.w, Math.round(cx1 + half1));
      const y1 = Math.min(L1.h, Math.round(cy1 + half1));
      const frac = Math.max(rainFraction(pairs[0].A[1], x0, y0, x1, y1), rainFraction(pairs[0].B[1], x0, y0, x1, y1));
      if (frac < 0.04) continue;

      // Coarse (level 2).
      const X0 = x0 >> 1, Y0 = y0 >> 1, X1 = x1 >> 1, Y1 = y1 >> 1;
      let best = Infinity;
      let sum = 0;
      let cnt = 0;
      let bdx = gdx;
      let bdy = gdy;
      for (let dy = gdy - LOCAL; dy <= gdy + LOCAL; dy++) {
        for (let dx = gdx - LOCAL; dx <= gdx + LOCAL; dx++) {
          const cst = pairCost(pairs, 2, X0, Y0, X1, Y1, dx, dy);
          if (!isFinite(cst)) continue;
          sum += cst;
          cnt++;
          if (cst < best) {
            best = cst;
            bdx = dx;
            bdy = dy;
          }
        }
      }
      if (!cnt || !isFinite(best)) continue;
      const contrast = (sum / cnt - best) / (sum / cnt + 1e-6);
      if (contrast < 0.12) continue;

      // Refine on level 1.
      let fdx = bdx * 2;
      let fdy = bdy * 2;
      let fBest = Infinity;
      const costs = new Map<string, number>();
      for (let dy = bdy * 2 - 2; dy <= bdy * 2 + 2; dy++) {
        for (let dx = bdx * 2 - 2; dx <= bdx * 2 + 2; dx++) {
          const cst = pairCost(pairs, 1, x0, y0, x1, y1, dx, dy);
          costs.set(dx + ',' + dy, cst);
          if (cst < fBest) {
            fBest = cst;
            fdx = dx;
            fdy = dy;
          }
        }
      }
      const get = (dx: number, dy: number) =>
        costs.get(dx + ',' + dy) ?? pairCost(pairs, 1, x0, y0, x1, y1, dx, dy);
      const sx = subpixel(get(fdx - 1, fdy), fBest, get(fdx + 1, fdy));
      const sy = subpixel(get(fdx, fdy - 1), fBest, get(fdx, fdy + 1));
      // Level-1 px → native px, per 5-minute step.
      u[idx] = ((fdx + sx) * 2) / steps;
      v[idx] = ((fdy + sy) * 2) / steps;
      valid[idx] = 1;
      fractions.push(frac);
      blockIdx.push(idx);
      bu.push(u[idx]);
      bv.push(v[idx]);
    }
  }

  // ---- 3. Outlier rejection ---------------------------------------------
  for (const idx of blockIdx) {
    const r = Math.floor(idx / cols);
    const c = idx % cols;
    const nu: number[] = [];
    const nv: number[] = [];
    for (let j = -1; j <= 1; j++) {
      for (let i = -1; i <= 1; i++) {
        const rr = r + j, cc = c + i;
        if (rr < 0 || cc < 0 || rr >= rows || cc >= cols || (i === 0 && j === 0)) continue;
        const k = rr * cols + cc;
        if (valid[k]) {
          nu.push(u[k]);
          nv.push(v[k]);
        }
      }
    }
    if (nu.length < 2) continue;
    const mu = weightedMedian(nu, nu.map(() => 1));
    const mv = weightedMedian(nv, nv.map(() => 1));
    const dev = Math.hypot(u[idx] - mu, v[idx] - mv);
    if (dev > Math.max(2.5, 0.6 * Math.hypot(mu, mv))) valid[idx] = 2; // mark rejected
  }

  const keptU: number[] = [];
  const keptV: number[] = [];
  const keptW: number[] = [];
  blockIdx.forEach((idx, i) => {
    if (valid[idx] === 1) {
      keptU.push(u[idx]);
      keptV.push(v[idx]);
      keptW.push(fractions[i]);
    } else valid[idx] = 0;
  });

  let globalU = (gdx * 4) / steps;
  let globalV = (gdy * 4) / steps;
  if (keptU.length >= 3) {
    globalU = weightedMedian(keptU, keptW);
    globalV = weightedMedian(keptV, keptW);
  }

  // ---- 4. Gap filling & smoothing ----------------------------------------
  const sigma = 3.5;
  const fu = new Float32Array(n);
  const fv = new Float32Array(n);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      if (valid[idx]) {
        fu[idx] = u[idx];
        fv[idx] = v[idx];
        continue;
      }
      let su = globalU * 0.25;
      let sv = globalV * 0.25;
      let sw = 0.25;
      for (const k of blockIdx) {
        if (!valid[k]) continue;
        const rr = Math.floor(k / cols);
        const cc = k % cols;
        const d2 = (rr - r) ** 2 + (cc - c) ** 2;
        const w = Math.exp(-d2 / (2 * sigma * sigma));
        su += u[k] * w;
        sv += v[k] * w;
        sw += w;
      }
      fu[idx] = su / sw;
      fv[idx] = sv / sw;
    }
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let su = 0, sv = 0, sw = 0;
      for (let j = -1; j <= 1; j++) {
        for (let i = -1; i <= 1; i++) {
          const rr = r + j, cc = c + i;
          if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue;
          const w = i === 0 && j === 0 ? 2 : 1;
          su += fu[rr * cols + cc] * w;
          sv += fv[rr * cols + cc] * w;
          sw += w;
        }
      }
      u[r * cols + c] = su / sw;
      v[r * cols + c] = sv / sw;
    }
  }

  // ---- 5. Confidence ---------------------------------------------------
  const coverage = keptU.length / n;
  let spread = 0;
  keptU.forEach((ku, i) => (spread += Math.hypot(ku - globalU, keptV[i] - globalV)));
  spread = keptU.length ? spread / keptU.length : Infinity;
  const consistency = 1 / (1 + spread / 1.5);
  const support = Math.min(1, keptU.length / 10);
  const confidence = Math.max(0, Math.min(1, support * (0.35 + 0.65 * consistency)));

  return { range, cols, rows, step: BLOCK_NATIVE, width: W, height: H, u, v, valid, globalU, globalV, confidence, coverage };
}

/** Stationary-echo (clutter) mask: echoes that sit unchanged scan after scan. */
export function detectClutter(frames: RadarFrame[]): Uint8Array | null {
  if (frames.length < 8) return null;
  const latest = frames[frames.length - 1];
  const N = latest.levels.length;
  const W = latest.width;
  const mask = new Uint8Array(N);
  const present = new Uint16Array(N);
  const same = new Uint16Array(N);
  for (const f of frames) {
    const L = f.levels;
    for (let i = 0; i < N; i++) {
      if (L[i] > 0) {
        present[i]++;
        if (L[i] === latest.levels[i]) same[i]++;
      }
    }
  }
  const nf = frames.length;
  for (let i = 0; i < N; i++) {
    if (present[i] >= nf * 0.9 && same[i] >= nf * 0.6) mask[i] = 1;
  }
  // Dilate by one pixel to catch flickering edges.
  const out = mask.slice();
  for (let i = 0; i < N; i++) {
    if (!mask[i]) continue;
    const x = i % W;
    if (x > 0) out[i - 1] = 1;
    if (x < W - 1) out[i + 1] = 1;
    if (i >= W) out[i - W] = 1;
    if (i + W < N) out[i + W] = 1;
  }
  return out;
}

/** Growth/decay of echo coverage per 5-minute step over the last ~30 min. */
export function coverageTrend(frames: RadarFrame[], clutter: Uint8Array | null): number {
  if (frames.length < 2) return 1;
  const latest = frames[frames.length - 1];
  const target = latest.time - 6 * FRAME_MS;
  let older = frames[0];
  for (const f of frames) if (f.time <= target) older = f;
  if (older === latest) older = frames[frames.length - 2];
  const area = (f: RadarFrame) => {
    let s = 0;
    for (let i = 0; i < f.levels.length; i++) if (f.levels[i] > 0 && !(clutter && clutter[i])) s++;
    return s;
  };
  const a1 = area(latest);
  const a0 = area(older);
  const steps = Math.max(1, Math.round((latest.time - older.time) / FRAME_MS));
  if (a0 < 50 || a1 < 50) return 1;
  const g = Math.pow(a1 / a0, 1 / steps);
  return Math.max(0.94, Math.min(1.06, g));
}
