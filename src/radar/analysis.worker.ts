/// <reference lib="webworker" />
/**
 * Off-main-thread radar analysis: clutter detection, echo tracking, forecast
 * imagery and point forecasts. Keeps the UI at 60 fps while crunching.
 */
import { DISPLAY_FORECAST_STEPS, FRAME_MS, RANGES, type RadarRange } from '../config';
import { coverageTrend, detectClutter, estimateMotion } from './motion';
import { kmPerPixel } from './frameMath';
import { advect, domainWind, pointForecast, type AnalysisState, type RangeState } from './nowcast';
import type { AnalysisSummary, PointForecast, RadarFrame } from './types';

export type RangeFrames = Partial<Record<RadarRange, RadarFrame[]>>;

export type WorkerRequest =
  | { type: 'analyze'; id: number; frames: RangeFrames }
  | { type: 'points'; id: number; points: Array<{ key: string; lat: number; lon: number }> };

export type WorkerResponse =
  | {
      type: 'analysis';
      id: number;
      summary: AnalysisSummary;
      forecast: Partial<Record<RadarRange, Array<{ time: number; levels: Uint8Array }>>>;
      clutter: Partial<Record<RadarRange, Uint8Array | null>>;
    }
  | { type: 'points'; id: number; results: Array<{ key: string; forecast: PointForecast }> }
  | { type: 'error'; id: number; message: string };

let state: AnalysisState | null = null;

const ctx = self as unknown as DedicatedWorkerGlobalScope;

function rangeState(frames: RadarFrame[], prior: RangeState | null): RangeState | null {
  if (!frames.length) return null;
  const sorted = [...frames].sort((a, b) => a.time - b.time);
  const clutter = detectClutter(sorted);
  const latest = sorted[sorted.length - 1];
  // Seed with the coarser range's steering flow when that estimate is trustworthy.
  let p: { u: number; v: number } | null = null;
  const pm = prior?.motion;
  if (pm && pm.confidence >= 0.3) {
    const s = kmPerPixel(pm.range, pm.width).kx / kmPerPixel(latest.range, latest.width).kx;
    p = { u: pm.globalU * s, v: pm.globalV * s };
  }
  const motion = estimateMotion(sorted, clutter, p);
  return { frame: latest, motion, clutter };
}

function regionCoverage(r: RangeState | undefined): number {
  if (!r) return 0;
  // Approximate Singapore: the central band of the 70 km image.
  const f = r.frame;
  const x0 = Math.floor(f.width * 0.33), x1 = Math.floor(f.width * 0.67);
  const y0 = Math.floor(f.height * 0.38), y1 = Math.floor(f.height * 0.62);
  let rain = 0, n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = y * f.width + x;
    n++;
    if (f.levels[i] > 0 && !(r.clutter && r.clutter[i])) rain++;
  }
  return n ? rain / n : 0;
}

ctx.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data;
  try {
    if (msg.type === 'analyze') {
      const ranges: AnalysisState['ranges'] = {};
      // Coarse to fine: the wide, stable views constrain the detailed one.
      let prior: RangeState | null = null;
      for (const r of [...RANGES].reverse()) {
        const rs = rangeState(msg.frames[r] ?? [], prior);
        if (rs) {
          ranges[r] = rs;
          prior = rs;
        }
      }
      const sorted70 = [...(msg.frames['70km'] ?? [])].sort((a, b) => a.time - b.time);
      const trend = sorted70.length ? coverageTrend(sorted70, ranges['70km']?.clutter ?? null) : 1;
      const wind = domainWind(ranges);
      state = { ranges, trend, wind };

      const forecast: Extract<WorkerResponse, { type: 'analysis' }>['forecast'] = {};
      const clutter: Extract<WorkerResponse, { type: 'analysis' }>['clutter'] = {};
      const transfer: ArrayBuffer[] = [];
      for (const r of RANGES) {
        const rs = ranges[r];
        if (!rs) continue;
        clutter[r] = rs.clutter;
        forecast[r] = advect(rs, DISPLAY_FORECAST_STEPS, trend).map((levels, i) => {
          transfer.push(levels.buffer as ArrayBuffer);
          return { time: rs.frame.time + (i + 1) * FRAME_MS, levels };
        });
      }
      const first = RANGES.map((r) => ranges[r]).find(Boolean);
      const summary: AnalysisSummary = {
        issued: first?.frame.time ?? Date.now(),
        wind,
        trend,
        regionCoverage: regionCoverage(ranges['70km']),
        motion: Object.fromEntries(RANGES.map((r) => [r, ranges[r]?.motion ?? null]))
      };
      const res: WorkerResponse = { type: 'analysis', id: msg.id, summary, forecast, clutter };
      ctx.postMessage(res, transfer);
    } else if (msg.type === 'points') {
      if (!state) throw new Error('No analysis yet');
      const s = state;
      const results = msg.points.map((p) => ({ key: p.key, forecast: pointForecast(s, p.lat, p.lon) }));
      ctx.postMessage({ type: 'points', id: msg.id, results } satisfies WorkerResponse);
    }
  } catch (err) {
    ctx.postMessage({ type: 'error', id: msg.id, message: String((err as Error)?.message ?? err) } satisfies WorkerResponse);
  }
};
