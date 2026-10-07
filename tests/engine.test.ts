import { describe, expect, it } from 'vitest';
import { RADAR_BBOX, FRAME_MS } from '../src/config';
import { estimateMotion, detectClutter } from '../src/radar/motion';
import { advect, domainWind, pointForecast } from '../src/radar/nowcast';
import { pixelToGeo, vectorToWind } from '../src/radar/frameMath';
import { colorToLevel, levelToRate, rateToLevel } from '../src/radar/palette';
import { cellAt, fromSVY21, toSVY21 } from '../src/lib/svy21';
import type { RadarFrame } from '../src/radar/types';

const W = 480;

/** Synthetic storm: a few Gaussian cells translated by (u, v) px per 5 min. */
function synth(range: '70km' | '240km', step: number, u: number, v: number, t0 = 1_700_000_000_000): RadarFrame {
  const levels = new Uint8Array(W * W);
  const cells = [
    [140, 180, 22], [200, 230, 14], [300, 120, 18], [90, 320, 26], [260, 300, 12]
  ];
  for (const [cx0, cy0, r] of cells) {
    const cx = cx0 + u * step, cy = cy0 + v * step;
    for (let y = Math.max(0, Math.floor(cy - 2 * r)); y < Math.min(W, cy + 2 * r); y++) {
      for (let x = Math.max(0, Math.floor(cx - 2 * r)); x < Math.min(W, cx + 2 * r); x++) {
        const d2 = ((x - cx) ** 2 + (y - cy) ** 2) / (r * r);
        const val = Math.round(30 * Math.exp(-d2));
        if (val > 0) levels[y * W + x] = Math.max(levels[y * W + x], val);
      }
    }
  }
  return { range, time: t0 + step * FRAME_MS, width: W, height: W, levels, bbox: RADAR_BBOX[range] };
}

describe('palette', () => {
  it('maps legend colours exactly and rates monotonically', () => {
    expect(colorToLevel(0, 255, 255)).toBe(1);
    expect(colorToLevel(255, 0, 255)).toBe(33);
    for (let l = 2; l <= 33; l++) expect(levelToRate(l)).toBeGreaterThan(levelToRate(l - 1));
    for (let l = 1; l <= 33; l++) expect(rateToLevel(levelToRate(l))).toBe(l);
  });
});

describe('svy21', () => {
  it('matches reference projection and round-trips', () => {
    const p = toSVY21(1.2949192688485278, 103.77367436885834);
    // Reference values from PROJ (EPSG:4326 → EPSG:3414).
    expect(Math.abs(p.N - 30811.19)).toBeLessThan(0.5);
    expect(Math.abs(p.E - 21362.12)).toBeLessThan(0.5);
    const q = toSVY21(1.3521, 103.8198);
    expect(Math.abs(q.N - 37133.87)).toBeLessThan(0.5);
    expect(Math.abs(q.E - 26495.53)).toBeLessThan(0.5);
    const back = fromSVY21(p.N, p.E);
    expect(back.lat).toBeCloseTo(1.2949192688485278, 7);
    expect(back.lon).toBeCloseTo(103.77367436885834, 7);
  });
  it('builds 5 m cells containing the point', () => {
    const c = cellAt(1.3521, 103.8198, 5);
    const { N, E } = toSVY21(1.3521, 103.8198);
    expect(N - c.N0).toBeGreaterThanOrEqual(0);
    expect(N - c.N0).toBeLessThan(5);
    expect(E - c.E0).toBeLessThan(5);
  });
});

describe('motion tracking', () => {
  for (const [u, v] of [[2, 1], [-3, 0.5], [0.5, -2.5]]) {
    it(`recovers translation (${u}, ${v}) px/5min`, () => {
      const frames = [0, 1, 2, 3, 4, 5, 6].map((s) => synth('70km', s, u, v));
      const m = estimateMotion(frames, null)!;
      expect(m).not.toBeNull();
      expect(m.globalU).toBeCloseTo(u, 0);
      expect(m.globalV).toBeCloseTo(v, 0);
      expect(m.confidence).toBeGreaterThan(0.5);
    });
  }

  it('converts motion to meteorological wind', () => {
    // Moving east (u>0) means wind FROM the west (~270°).
    const w = vectorToWind('70km', W, 2, 0);
    expect(w.fromDeg).toBeCloseTo(270, 0);
    expect(w.speedKmh).toBeCloseTo(2 * 0.292 * 12, 0);
  });

  it('flags stationary echoes as clutter', () => {
    const frames = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((s) => {
      const f = synth('70km', s, 3, 0);
      f.levels[100 * W + 400] = 20; // fixed speck
      return f;
    });
    const mask = detectClutter(frames)!;
    expect(mask[100 * W + 400]).toBe(1);
    expect(mask[180 * W + 140 + 27]).toBe(0);
  });
});

describe('nowcast', () => {
  it('advects rain downstream and forecasts arrival at a point', () => {
    const u = 6, v = 0;
    const frames = [0, 1, 2, 3, 4, 5, 6].map((s) => synth('70km', s, u, v));
    const latest = frames[frames.length - 1];
    const motion = estimateMotion(frames, null);
    const r70 = { frame: latest, motion, clutter: null };
    const fc = advect(r70, 6, 1);
    // Centre of cell 1 at step 6 is x=140+36=176; after 6 more steps → 212.
    expect(fc[5][180 * W + 212]).toBeGreaterThan(20);

    // A point 60 px (~17 km) east of the cell centre is dry now but wet soon.
    const p = pixelToGeo(latest.bbox, W, W, 176 + 60 + 0.5, 180.5);
    const state = { ranges: { '70km': r70 }, trend: 1, wind: domainWind({ '70km': r70 }) };
    const pf = pointForecast(state, p.lat, p.lon);
    expect(pf.nowRate).toBeLessThan(0.1);
    const first = pf.steps.find((s) => s.prob >= 0.5);
    expect(first).toBeTruthy();
    expect(first!.lead).toBeGreaterThanOrEqual(10);
    expect(first!.lead).toBeLessThanOrEqual(50);
    expect(pf.upstream).not.toBeNull();
    expect(pf.upstream!.bearingDeg).toBeGreaterThan(240);
    expect(pf.upstream!.bearingDeg).toBeLessThan(300);
  });
});
