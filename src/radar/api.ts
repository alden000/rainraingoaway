/**
 * data.gov.sg weather-radar client. Lists recent scans, downloads the
 * presigned PNGs and decodes them into level rasters, with an IndexedDB cache
 * so reloads (and offline launches) are instant.
 */
import { API_BASE, FRAME_MS, RADAR_BBOX, type RadarRange } from '../config';
import { idb } from '../lib/idb';
import { rgbaToLevels } from './palette';
import type { RadarFrame } from './types';

interface ApiRecord {
  timestamp: string;
  updatedTimestamp: string;
  image: { url: string; urlExpiresAt: string; range: string };
}

interface ApiResponse {
  code: number;
  errorMsg?: string;
  data: { records: ApiRecord[]; paginationToken?: string | null } | null;
}

export interface ScanRef {
  range: RadarRange;
  time: number;
  url: string;
}

const SGT_OFFSET_MS = 8 * 3600_000;

/** YYYY-MM-DD in Singapore time for an epoch. */
export function sgtDate(epoch: number): string {
  return new Date(epoch + SGT_OFFSET_MS).toISOString().slice(0, 10);
}

async function getJson(url: string, signal?: AbortSignal): Promise<ApiResponse> {
  const res = await fetch(url, { signal, cache: 'no-store' });
  if (!res.ok && res.status !== 404) throw new Error(`Radar API ${res.status}`);
  const json = (await res.json()) as ApiResponse;
  if (res.status === 404) return { code: 17, data: { records: [] } };
  if (json.code !== 0) throw new Error(json.errorMsg || 'Radar API error');
  return json;
}

function toRefs(range: RadarRange, records: ApiRecord[]): ScanRef[] {
  return records
    .map((r) => ({ range, time: Date.parse(r.timestamp), url: r.image.url }))
    .filter((r) => Number.isFinite(r.time) && !!r.url);
}

export async function listLatest(range: RadarRange, signal?: AbortSignal): Promise<ScanRef | null> {
  const json = await getJson(`${API_BASE}/${range}`, signal);
  return toRefs(range, json.data?.records ?? [])[0] ?? null;
}

/** The most recent `count` scans (newest first), crossing midnight if needed. */
export async function listRecent(range: RadarRange, count: number, signal?: AbortSignal): Promise<ScanRef[]> {
  const now = Date.now();
  const out = new Map<number, ScanRef>();
  const oldest = now - (count + 1) * FRAME_MS;
  for (const day of new Set([sgtDate(now), sgtDate(oldest)])) {
    if (out.size >= count) break;
    let token: string | null | undefined;
    let pages = 0;
    do {
      const qs = new URLSearchParams({ date: day });
      if (token) qs.set('paginationToken', token);
      const json = await getJson(`${API_BASE}/${range}?${qs}`, signal);
      const refs = toRefs(range, json.data?.records ?? []);
      refs.forEach((r) => out.set(r.time, r));
      token = json.data?.paginationToken;
      pages++;
      // Pages are newest-first: stop once we have enough scans or reached far enough back.
      if (out.size >= count || (refs.length && Math.min(...refs.map((r) => r.time)) <= oldest)) break;
    } while (token && pages < 4);
  }
  return [...out.values()].sort((a, b) => b.time - a.time).slice(0, count);
}

const memory = new Map<string, RadarFrame>();
const inflight = new Map<string, Promise<RadarFrame>>();
const key = (range: RadarRange, time: number) => `${range}|${time}`;

async function decodePng(blob: Blob): Promise<{ width: number; height: number; rgba: Uint8ClampedArray }> {
  const bmp = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const { width, height } = bmp;
  let ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
  if (typeof OffscreenCanvas !== 'undefined') {
    ctx = new OffscreenCanvas(width, height).getContext('2d', { willReadFrequently: true });
  } else {
    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    ctx = c.getContext('2d', { willReadFrequently: true });
  }
  if (!ctx) throw new Error('Canvas unavailable');
  ctx.drawImage(bmp, 0, 0);
  bmp.close?.();
  return { width, height, rgba: ctx.getImageData(0, 0, width, height).data };
}

interface StoredFrame {
  range: RadarRange;
  time: number;
  width: number;
  height: number;
  levels: Uint8Array;
}

export async function loadFrame(ref: ScanRef, signal?: AbortSignal): Promise<RadarFrame> {
  const k = key(ref.range, ref.time);
  const hit = memory.get(k);
  if (hit) return hit;
  const pending = inflight.get(k);
  if (pending) return pending;
  const p = (async () => {
    const stored = await idb.get<StoredFrame>(k);
    if (stored?.levels) {
      const f: RadarFrame = { ...stored, bbox: RADAR_BBOX[stored.range] };
      memory.set(k, f);
      return f;
    }
    const res = await fetch(ref.url, { signal, mode: 'cors' });
    if (!res.ok) throw new Error(`Radar image ${res.status}`);
    const { width, height, rgba } = await decodePng(await res.blob());
    const levels = rgbaToLevels(rgba);
    const frame: RadarFrame = { range: ref.range, time: ref.time, width, height, levels, bbox: RADAR_BBOX[ref.range] };
    memory.set(k, frame);
    void idb.set(k, { range: ref.range, time: ref.time, width, height, levels } satisfies StoredFrame);
    return frame;
  })();
  inflight.set(k, p);
  try {
    return await p;
  } finally {
    inflight.delete(k);
  }
}

export async function loadFrames(refs: ScanRef[], concurrency = 4, signal?: AbortSignal): Promise<RadarFrame[]> {
  const out: Array<RadarFrame | null> = new Array(refs.length).fill(null);
  let next = 0;
  const worker = async () => {
    while (next < refs.length) {
      const i = next++;
      try {
        out[i] = await loadFrame(refs[i], signal);
      } catch (e) {
        if ((e as Error).name === 'AbortError') throw e;
        out[i] = null; // tolerate the odd missing scan
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, refs.length) }, worker));
  return out.filter((f): f is RadarFrame => !!f).sort((a, b) => a.time - b.time);
}

/** Frames available offline, newest last. */
export async function cachedFrames(range: RadarRange, maxAgeMs: number): Promise<RadarFrame[]> {
  const cutoff = Date.now() - maxAgeMs;
  const keys = (await idb.keys()).filter((k) => k.startsWith(range + '|'));
  const frames: RadarFrame[] = [];
  for (const k of keys) {
    const time = Number(k.split('|')[1]);
    if (time < cutoff) continue;
    const f = await loadFrame({ range, time, url: '' }).catch(() => null);
    if (f) frames.push(f);
  }
  return frames.sort((a, b) => a.time - b.time);
}

/** Drop cached scans older than `maxAgeMs`. */
export async function pruneCache(maxAgeMs: number): Promise<void> {
  const cutoff = Date.now() - maxAgeMs;
  for (const k of await idb.keys()) {
    const time = Number(k.split('|')[1]);
    if (!Number.isFinite(time) || time < cutoff) {
      await idb.del(k);
      memory.delete(k);
    }
  }
  for (const k of memory.keys()) if (Number(k.split('|')[1]) < cutoff) memory.delete(k);
}
