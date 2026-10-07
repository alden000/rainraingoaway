/// <reference lib="webworker" />
/**
 * Off-main-thread radar analysis: clutter detection, echo tracking, forecast
 * imagery and point forecasts. Keeps the UI at 60 fps while crunching.
 */
import { DISPLAY_FORECAST_STEPS, FRAME_MS } from '../config';
import { coverageTrend, detectClutter, estimateMotion } from './motion';
import { advect, domainWind, pointForecast, type AnalysisState, type RangeState } from './nowcast';
import type { AnalysisSummary, PointForecast, RadarFrame } from './types';

export type WorkerRequest =
  | { type: 'analyze'; id: number; frames70: RadarFrame[]; frames240: RadarFrame[] }
  | { type: 'points'; id: number; points: Array<{ key: string; lat: number; lon: number }> };

export type WorkerResponse =
  | {
      type: 'analysis';
      id: number;
      summary: AnalysisSummary;
      forecast: Array<{ time: number; levels: Uint8Array }>;
      clutter70: Uint8Array | null;
    }
  | { type: 'points'; id: number; results: Array<{ key: string; forecast: PointForecast }> }
  | { type: 'error'; id: number; message: string };

let state: AnalysisState | null = null;

const ctx = self as unknown as DedicatedWorkerGlobalScope;

function rangeState(frames: RadarFrame[], withClutter: boolean): RangeState | null {
  if (!frames.length) return null;
  const sorted = [...frames].sort((a, b) => a.time - b.time);
  const clutter = withClutter ? detectClutter(sorted) : null;
  const motion = estimateMotion(sorted, clutter);
  return { frame: sorted[sorted.length - 1], motion, clutter };
}

function regionCoverage(r: RangeState | null): number {
  if (!r) return 0;
  // Approximate region of interest: the central ~third of the 70 km image.
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
      const r70 = rangeState(msg.frames70, true);
      const r240 = rangeState(msg.frames240, msg.frames240.length >= 8);
      const sorted70 = [...msg.frames70].sort((a, b) => a.time - b.time);
      const trend = sorted70.length ? coverageTrend(sorted70, r70?.clutter ?? null) : 1;
      const wind = domainWind(r70, r240);
      state = { r70, r240, trend, wind };

      const forecast: Array<{ time: number; levels: Uint8Array }> = [];
      if (r70) {
        const fields = advect(r70, DISPLAY_FORECAST_STEPS, trend);
        fields.forEach((levels, i) => forecast.push({ time: r70.frame.time + (i + 1) * FRAME_MS, levels }));
      }
      const summary: AnalysisSummary = {
        issued: r70?.frame.time ?? r240?.frame.time ?? Date.now(),
        wind,
        trend,
        regionCoverage: regionCoverage(r70),
        motion70: r70?.motion ?? null,
        motion240: r240?.motion ?? null
      };
      const res: WorkerResponse = { type: 'analysis', id: msg.id, summary, forecast, clutter70: r70?.clutter ?? null };
      ctx.postMessage(res, forecast.map((f) => f.levels.buffer));
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
