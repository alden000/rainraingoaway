/**
 * Nowcasting by semi-Lagrangian extrapolation: the latest scan is carried
 * forward along the tracked motion field, with a gentle growth/decay term and
 * a neighbourhood ("probability") treatment that widens with lead time to
 * reflect growing uncertainty.
 */
import { FRAME_MS, POINT_FORECAST_STEPS, RANGES, type RadarRange } from '../config';
import { distanceKm, bearingDeg } from '../lib/geo';
import { RAIN_THRESHOLD, LEVEL_COUNT, rateToLevel } from './palette';
import {
  RATE_LUT, geoToPixel, kmPerPixel, motionAt, nearestLevel, pixelToGeo, sampleRate, vectorToWind
} from './frameMath';
import type {
  ForecastStep, MotionField, NearestRain, PointForecast, RadarFrame, UpstreamRain, WindEstimate
} from './types';

export interface RangeState {
  frame: RadarFrame;
  motion: MotionField | null;
  clutter: Uint8Array | null;
}

export interface AnalysisState {
  ranges: Partial<Record<RadarRange, RangeState>>;
  trend: number;
  wind: WindEstimate;
}

/** Longest lead (minutes) each range is trusted for before handing over to a wider one. */
const MAX_LEAD: Record<RadarRange, number> = { '70km': 90, '240km': 180, '480km': 180 };
const EDGE_MARGIN: Record<RadarRange, number> = { '70km': 6, '240km': 2, '480km': 1 };

/** Level remap applying growth/decay over k steps. */
function trendLut(trend: number, k: number): Uint8Array {
  const lut = new Uint8Array(256);
  const g = Math.pow(trend, k);
  for (let l = 1; l <= LEVEL_COUNT; l++) lut[l] = rateToLevel(RATE_LUT[l] * g);
  return lut;
}

/** Trajectory lattice spacing (px). The motion field is smooth on ~24 px blocks, so tracing every 4th pixel and interpolating is visually identical and ~10x cheaper. */
const LATTICE = 4;

/** Produce forecast rasters (levels) for k = 1..steps. */
export function advect(state: RangeState, steps: number, trend: number): Uint8Array[] {
  const { frame, motion, clutter } = state;
  const { width: W, height: H, levels } = frame;
  const N = W * H;
  const src = new Uint8Array(N);
  for (let i = 0; i < N; i++) src[i] = clutter && clutter[i] ? 0 : levels[i];

  // Back-trajectories for lattice nodes at pixel centres (i*L + 0.5, j*L + 0.5).
  const gw = Math.floor((W - 1) / LATTICE) + 2;
  const gh = Math.floor((H - 1) / LATTICE) + 2;
  const G = gw * gh;
  const ox = new Float32Array(G);
  const oy = new Float32Array(G);
  const gx = new Float32Array(G);
  const gy = new Float32Array(G);
  for (let j = 0, n = 0; j < gh; j++) {
    for (let i = 0; i < gw; i++, n++) {
      gx[n] = ox[n] = i * LATTICE + 0.5;
      gy[n] = oy[n] = j * LATTICE + 0.5;
    }
  }
  const dx = new Float32Array(G);
  const dy = new Float32Array(G);

  // Per-column/row interpolation indices and weights, reused every step.
  const ci = new Int32Array(W), cw = new Float32Array(W);
  for (let x = 0; x < W; x++) {
    ci[x] = Math.floor(x / LATTICE);
    cw[x] = (x % LATTICE) / LATTICE;
  }
  const ri = new Int32Array(H), rw = new Float32Array(H);
  for (let y = 0; y < H; y++) {
    ri[y] = Math.floor(y / LATTICE);
    rw[y] = (y % LATTICE) / LATTICE;
  }

  const out: Uint8Array[] = [];
  for (let k = 1; k <= steps; k++) {
    const lut = trendLut(trend, k);
    if (motion) {
      for (let n = 0; n < G; n++) {
        // Midpoint (RK2) back-trajectory step.
        const [u1, v1] = motionAt(motion, gx[n], gy[n]);
        const [u, v] = motionAt(motion, gx[n] - u1 / 2, gy[n] - v1 / 2);
        gx[n] -= u;
        gy[n] -= v;
        dx[n] = gx[n] - ox[n];
        dy[n] = gy[n] - oy[n];
      }
    }
    const dst = new Uint8Array(N);
    for (let y = 0, i = 0; y < H; y++) {
      const r0 = ri[y] * gw, r1 = r0 + gw, ty = rw[y], sy = 1 - ty;
      for (let x = 0; x < W; x++, i++) {
        const c = ci[x], tx = cw[x], sx = 1 - tx;
        const a = r0 + c, b = a + 1, d = r1 + c, e = d + 1;
        const px = x + 0.5 + (dx[a] * sx + dx[b] * tx) * sy + (dx[d] * sx + dx[e] * tx) * ty;
        const py = y + 0.5 + (dy[a] * sx + dy[b] * tx) * sy + (dy[d] * sx + dy[e] * tx) * ty;
        const xi = px | 0;
        const yi = py | 0;
        if (px < 0 || py < 0 || xi >= W || yi >= H) continue;
        dst[i] = lut[src[yi * W + xi]];
      }
    }
    out.push(dst);
  }
  return out;
}

/** Gaussian-weighted rain probability and conditional mean rate around a pixel. */
function neighbourhood(state: RangeState, x: number, y: number, sigmaKm: number) {
  const { frame, clutter } = state;
  const { width: W, height: H, levels, range } = frame;
  const { kx, ky } = kmPerPixel(range, W);
  const sx = Math.max(0.6, sigmaKm / kx);
  const sy = Math.max(0.6, sigmaKm / ky);
  const rx = Math.ceil(sx * 2);
  const ry = Math.ceil(sy * 2);
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  let wSum = 0, wRain = 0, rSum = 0;
  for (let j = -ry; j <= ry; j++) {
    const yy = cy + j;
    if (yy < 0 || yy >= H) continue;
    const dy = (yy + 0.5 - y) / sy;
    for (let i = -rx; i <= rx; i++) {
      const xx = cx + i;
      if (xx < 0 || xx >= W) continue;
      const dx = (xx + 0.5 - x) / sx;
      const d2 = dx * dx + dy * dy;
      if (d2 > 4) continue;
      const w = Math.exp(-0.5 * d2);
      wSum += w;
      const idx = yy * W + xx;
      const l = levels[idx];
      if (l > 0 && !(clutter && clutter[idx])) {
        wRain += w;
        rSum += w * RATE_LUT[l];
      }
    }
  }
  if (!wSum) return { prob: 0, rate: 0 };
  return { prob: wRain / wSum, rate: wRain ? rSum / wRain : 0 };
}

function inside(f: RadarFrame, x: number, y: number, margin = 0) {
  return x >= margin && y >= margin && x < f.width - margin && y < f.height - margin;
}

function trajectoryStep(m: MotionField | null, x: number, y: number): [number, number] {
  if (!m) return [x, y];
  const [u1, v1] = motionAt(m, x, y);
  const [u, v] = motionAt(m, x - u1 / 2, y - v1 / 2);
  return [x - u, y - v];
}

export function pointForecast(state: AnalysisState, lat: number, lon: number): PointForecast {
  const { trend } = state;
  const available = RANGES.map((r) => state.ranges[r]).filter((r): r is RangeState => !!r);
  const issued = available[0]?.frame.time ?? Date.now();

  // ---- Now: the finest range that covers the spot -------------------------
  let nowRate = 0;
  let nowLevel = 0;
  let clutter = false;
  const primary = available.find((r) => inside(r.frame, ...xy(r.frame, lat, lon))) ?? null;
  if (primary) {
    const [x, y] = xy(primary.frame, lat, lon);
    const f = primary.frame;
    nowLevel = nearestLevel(f.levels, f.width, f.height, x, y);
    const idx = Math.floor(y) * f.width + Math.floor(x);
    clutter = !!(primary.clutter && primary.clutter[idx] && nowLevel > 0);
    nowRate = clutter ? 0 : sampleRate(f.levels, f.width, f.height, x, y, primary.clutter);
    if (clutter) nowLevel = 0;
  }

  // ---- Steps: one back-trajectory per range, finest usable range wins ------
  const steps: ForecastStep[] = [
    { lead: 0, prob: nowRate >= RAIN_THRESHOLD ? 1 : 0, rate: nowRate, source: primary?.frame.range ?? '70km' }
  ];
  const conf = state.wind.confidence;
  const pos = new Map<RangeState, [number, number]>();
  const motion = new Map<RangeState, MotionField | null>();
  for (const r of available) {
    const p = xy(r.frame, lat, lon);
    if (inside(r.frame, p[0], p[1])) pos.set(r, p);
    motion.set(r, r.motion ?? fallbackMotion(state, r.frame.range));
  }

  for (let k = 1; k <= POINT_FORECAST_STEPS; k++) {
    const lead = k * 5;
    for (const [r, p] of pos) pos.set(r, trajectoryStep(motion.get(r) ?? null, p[0], p[1]));
    // Uncertainty grows with lead time, and faster when tracking is shaky.
    const sigmaKm = (0.5 + 0.075 * lead) * (1 + (1 - conf) * 0.8);
    const use = available.find((r) => {
      const p = pos.get(r);
      return p && lead <= MAX_LEAD[r.frame.range] && inside(r.frame, p[0], p[1], EDGE_MARGIN[r.frame.range]);
    });
    if (!use) {
      steps.push({ lead, prob: 0, rate: 0, source: available[available.length - 1]?.frame.range ?? '480km' });
      continue;
    }
    const p = pos.get(use)!;
    const nb = neighbourhood(use, p[0], p[1], sigmaKm);
    const g = Math.pow(trend, k);
    steps.push({ lead, prob: Math.min(1, nb.prob * Math.min(1, g)), rate: nb.rate * g, source: use.frame.range });
  }

  return {
    lat, lon, issued, nowRate, nowLevel, clutter, steps,
    upstream: upstreamRain(state, lat, lon),
    nearest: nearestRain(state, lat, lon),
    trend,
    wind: localWind(state, lat, lon)
  };
}

function xy(f: RadarFrame, lat: number, lon: number): [number, number] {
  const p = geoToPixel(f.bbox, f.width, f.height, lat, lon);
  return [p.x, p.y];
}

/** Uniform field derived from the most confident other range's global vector. */
function fallbackMotion(state: AnalysisState, range: RadarRange): MotionField | null {
  const self = state.ranges[range];
  if (!self) return null;
  const other = RANGES.map((r) => state.ranges[r])
    .filter((r): r is RangeState => !!r && r !== self && !!r.motion && r.motion.confidence > 0)
    .sort((a, b) => b.motion!.confidence - a.motion!.confidence)[0];
  if (!other?.motion) return null;
  const { kx: okx } = kmPerPixel(other.frame.range, other.frame.width);
  const { kx: skx } = kmPerPixel(range, self.frame.width);
  const s = okx / skx;
  const W = self.frame.width;
  return {
    range, cols: 1, rows: 1, step: W, width: W, height: self.frame.height,
    u: new Float32Array([other.motion.globalU * s]), v: new Float32Array([other.motion.globalV * s]),
    valid: new Uint8Array([1]), globalU: other.motion.globalU * s, globalV: other.motion.globalV * s,
    confidence: other.motion.confidence, coverage: 0
  };
}

/** Follow the flow upwind from the spot to find the rain that is heading here. */
function upstreamRain(state: AnalysisState, lat: number, lon: number): UpstreamRain | null {
  // Prefer the 240 km view (≈1 km pixels); fall back to the wider or finer scans.
  const r = (['240km', '480km', '70km'] as RadarRange[])
    .map((k) => state.ranges[k])
    .find((rs) => rs && inside(rs.frame, ...xy(rs.frame, lat, lon)));
  if (!r) return null;
  const motion = r.motion ?? fallbackMotion(state, r.frame.range);
  const f = r.frame;
  const [x0, y0] = xy(f, lat, lon);
  if (!inside(f, x0, y0)) return null;
  const { kx } = kmPerPixel(f.range, f.width);
  const speed = motion ? Math.hypot(motion.globalU, motion.globalV) * kx * 12 : 0;
  if (!motion || speed < 3) return null;

  // March back in time in 1-minute sub-steps for up to 6 hours.
  let x = x0, y = y0;
  for (let minute = 1; minute <= 360; minute++) {
    const [u, v] = motionAt(motion, x, y);
    x -= u / 5;
    y -= v / 5;
    if (!inside(f, x, y)) return null;
    const travelledKm = Math.hypot((x - x0) * kx, (y - y0) * kx);
    if (travelledKm < 2) continue;
    // Corridor widens with distance (spread of possible paths).
    const radiusPx = Math.max(1.5, (1 + travelledKm * 0.08) / kx);
    const hit = scanDisk(r, x, y, radiusPx);
    if (hit) {
      const geo = pixelToGeo(f.bbox, f.width, f.height, x, y);
      return {
        distanceKm: distanceKm({ lat, lon }, geo),
        bearingDeg: bearingDeg({ lat, lon }, geo),
        etaMin: minute,
        rate: hit
      };
    }
  }
  return null;
}

function scanDisk(r: RangeState, x: number, y: number, radius: number): number {
  const f = r.frame;
  const cx = Math.floor(x), cy = Math.floor(y);
  const R = Math.ceil(radius);
  let best = 0;
  let count = 0;
  for (let j = -R; j <= R; j++) {
    const yy = cy + j;
    if (yy < 0 || yy >= f.height) continue;
    for (let i = -R; i <= R; i++) {
      if (i * i + j * j > radius * radius) continue;
      const xx = cx + i;
      if (xx < 0 || xx >= f.width) continue;
      const idx = yy * f.width + xx;
      const l = f.levels[idx];
      if (l > 0 && !(r.clutter && r.clutter[idx])) {
        count++;
        best = Math.max(best, RATE_LUT[l]);
      }
    }
  }
  // Ignore single-pixel speckle.
  return count >= 2 ? best : 0;
}

function nearestRain(state: AnalysisState, lat: number, lon: number): NearestRain | null {
  for (const r of RANGES.map((k) => state.ranges[k])) {
    if (!r) continue;
    const f = r.frame;
    const [x0, y0] = xy(f, lat, lon);
    if (!inside(f, x0, y0)) continue;
    const { kx, ky } = kmPerPixel(f.range, f.width);
    let best = Infinity;
    let bx = 0, by = 0, bl = 0;
    for (let y = 0; y < f.height; y++) {
      const dy = (y + 0.5 - y0) * ky;
      if (Math.abs(dy) > best) continue;
      for (let x = 0; x < f.width; x++) {
        const idx = y * f.width + x;
        const l = f.levels[idx];
        if (!l || (r.clutter && r.clutter[idx])) continue;
        const d = Math.hypot((x + 0.5 - x0) * kx, dy);
        if (d < best) {
          best = d;
          bx = x + 0.5;
          by = y + 0.5;
          bl = l;
        }
      }
    }
    if (isFinite(best)) {
      const geo = pixelToGeo(f.bbox, f.width, f.height, bx, by);
      return { distanceKm: best, bearingDeg: bearingDeg({ lat, lon }, geo), rate: RATE_LUT[bl] };
    }
  }
  return null;
}

/** Domain-wide wind, preferring the high-resolution range when it is trustworthy. */
export function domainWind(ranges: Partial<Record<RadarRange, RangeState>>): WindEstimate {
  const fields = RANGES.map((r) => ranges[r]?.motion).filter((m): m is MotionField => !!m);
  // Finest field that is trustworthy, else the most confident one.
  const pick = fields.find((m) => m.confidence >= 0.3) ?? [...fields].sort((a, b) => b.confidence - a.confidence)[0];
  if (!pick || pick.confidence === 0) return { fromDeg: 0, speedKmh: 0, confidence: 0, source: 'none' };
  const w = vectorToWind(pick.range, pick.width, pick.globalU, pick.globalV);
  return { fromDeg: w.fromDeg, speedKmh: w.speedKmh, confidence: pick.confidence, source: pick.range };
}

function localWind(state: AnalysisState, lat: number, lon: number): WindEstimate {
  const base = state.wind;
  if (base.source === 'none') return base;
  // Local steering from the finest field covering the spot.
  const r = RANGES.map((k) => state.ranges[k]).find((rs) => rs?.motion && rs.motion.confidence > 0 && inside(rs.frame, ...xy(rs.frame, lat, lon)));
  if (!r?.motion) return base;
  const [x, y] = xy(r.frame, lat, lon);
  if (!inside(r.frame, x, y)) return base;
  const [u, v] = motionAt(r.motion, x, y);
  const w = vectorToWind(r.frame.range, r.frame.width, u, v);
  return { ...base, localFromDeg: w.fromDeg, localSpeedKmh: w.speedKmh };
}

export const STEP_MS = FRAME_MS;
