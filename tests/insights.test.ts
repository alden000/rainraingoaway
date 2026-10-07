import { describe, expect, it } from 'vitest';
import { deriveInsights } from '../src/radar/insights';
import type { PointForecast } from '../src/radar/types';

const ISSUED = Date.parse('2026-10-07T08:00:00Z');

function pf(probs: number[], nowRate: number, extra: Partial<PointForecast> = {}): PointForecast {
  return {
    lat: 1.35, lon: 103.82, issued: ISSUED, nowRate, nowLevel: nowRate > 0 ? 8 : 0, clutter: false,
    steps: probs.map((p, i) => ({ lead: i * 5, prob: p, rate: p > 0 ? 3 : 0, source: '70km' as const })),
    upstream: null, nearest: null, trend: 1,
    wind: { fromDeg: 90, speedKmh: 15, confidence: 0.7, source: '70km' },
    ...extra
  };
}

const dry = (n: number) => Array(n).fill(0);

describe('deriveInsights', () => {
  it('announces rain starting within 30 minutes', () => {
    const steps = [0, 0, 0.2, 0.7, 0.9, 0.9, 0.9, ...dry(30)];
    const ins = deriveInsights(pf(steps, 0), ISSUED);
    expect(ins.raining).toBe(false);
    expect(ins.next.kind).toBe('start');
    expect(ins.next.minutes).toBe(15);
    expect(ins.tone).toBe('watch');
  });

  it('announces rain stopping within 30 minutes', () => {
    const steps = [1, 0.9, 0.8, 0.2, 0.1, 0, 0, ...dry(30)];
    const ins = deriveInsights(pf(steps, 4), ISSUED);
    expect(ins.raining).toBe(true);
    expect(ins.next.kind).toBe('stop');
    expect(ins.next.minutes).toBe(15);
    expect(ins.outlook.kind).toBe('clear');
  });

  it('predicts incoming rain beyond 30 minutes', () => {
    const steps = [...dry(7), ...dry(10), 0.6, 0.8, ...dry(17)];
    const ins = deriveInsights(pf(steps, 0), ISSUED);
    expect(ins.next.kind).toBe('dry');
    expect(ins.outlook.kind).toBe('incoming');
    expect(ins.outlook.minutes).toBe(85);
  });

  it('falls back to the upstream band when the field forecast is dry', () => {
    const ins = deriveInsights(
      pf(dry(37), 0, { upstream: { distanceKm: 60, bearingDeg: 225, etaMin: 200, rate: 5 } }),
      ISSUED
    );
    expect(ins.outlook.kind).toBe('incoming');
    expect(ins.outlook.text).toContain('SW');
  });

  it('accounts for scan latency in minutes-from-now', () => {
    const steps = [0, 0, 0.7, 0.9, 0.9, 0.9, 0.9, ...dry(30)];
    const ins = deriveInsights(pf(steps, 0), ISSUED + 4 * 60_000);
    expect(ins.next.minutes).toBe(6);
  });
});
