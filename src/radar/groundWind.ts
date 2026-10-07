/**
 * NEA ground-level wind (10 m stations, 1-minute averages) from data.gov.sg.
 * Shown next to the radar-derived steering wind so users can compare the
 * breeze at street level with the flow that carries the showers.
 */
import { distanceKm, type LatLon } from '../lib/geo';

const BASE = 'https://api-open.data.gov.sg/v2/real-time/api';
const KNOTS_TO_KMH = 1.852;
/** Beyond this distance a station says little about the spot. */
const MAX_STATION_KM = 25;

export interface GroundWind {
  station: string;
  distanceKm: number;
  fromDeg: number;
  speedKmh: number;
  time: number;
}

interface StationReading {
  name: string;
  lat: number;
  lon: number;
  fromDeg?: number;
  speedKmh?: number;
  time: number;
}

interface ApiResponse {
  code: number;
  data: {
    stations: Array<{ id: string; name: string; location: { latitude: number; longitude: number } }>;
    readings: Array<{ timestamp: string; data: Array<{ stationId: string; value: number }> }>;
  };
}

let stations: StationReading[] = [];

async function get(kind: 'wind-direction' | 'wind-speed'): Promise<ApiResponse | null> {
  try {
    const res = await fetch(`${BASE}/${kind}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const json = (await res.json()) as ApiResponse;
    return json.code === 0 ? json : null;
  } catch {
    return null;
  }
}

/** Refresh station readings. Keeps the previous set if NEA is unreachable. */
export async function refreshGroundWind(): Promise<void> {
  const [dir, spd] = await Promise.all([get('wind-direction'), get('wind-speed')]);
  if (!dir || !spd) return;
  const byId = new Map<string, StationReading>();
  for (const src of [dir, spd]) {
    for (const s of src.data.stations) {
      if (!byId.has(s.id)) byId.set(s.id, { name: s.name, lat: s.location.latitude, lon: s.location.longitude, time: 0 });
    }
  }
  const d = dir.data.readings[0];
  const v = spd.data.readings[0];
  for (const r of d?.data ?? []) {
    const s = byId.get(r.stationId);
    if (s) {
      s.fromDeg = r.value;
      s.time = Date.parse(d.timestamp);
    }
  }
  for (const r of v?.data ?? []) {
    const s = byId.get(r.stationId);
    if (s) s.speedKmh = r.value * KNOTS_TO_KMH;
  }
  const complete = [...byId.values()].filter((s) => s.fromDeg !== undefined && s.speedKmh !== undefined);
  if (complete.length) stations = complete;
}

/** Nearest station with a full reading, if one is close enough to be meaningful. */
export function groundWindAt(p: LatLon): GroundWind | null {
  let best: StationReading | null = null;
  let bestD = Infinity;
  for (const s of stations) {
    const d = distanceKm(p, { lat: s.lat, lon: s.lon });
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  if (!best || bestD > MAX_STATION_KM) return null;
  return { station: best.name, distanceKm: bestD, fromDeg: best.fromDeg!, speedKmh: best.speedKmh!, time: best.time };
}
