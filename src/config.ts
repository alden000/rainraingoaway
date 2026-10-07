/** Static configuration: endpoints, radar geometry and the app's region of interest. */

export const API_BASE = 'https://api-open.data.gov.sg/v2/real-time/api/weather-radar-images';

export type RadarRange = '70km' | '240km' | '480km';

/** Finest first. */
export const RANGES: RadarRange[] = ['70km', '240km', '480km'];

export interface BBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

export const RADAR_STATION = { lon: 103.972583, lat: 1.34911 };

/** Image footprints as published by data.gov.sg (EPSG:4326). */
export const RADAR_BBOX: Record<RadarRange, BBox> = {
  '70km': { west: 103.342685, north: 1.97854, east: 104.602315, south: 0.719515 },
  '240km': { west: 101.810507, north: 3.506012, east: 106.130495, south: -0.809711 },
  '480km': { west: 99.638609, north: 5.657912, east: 108.290871, south: -2.967382 }
};

/** Mainland Singapore plus outlying islands. */
export const SINGAPORE_BBOX: BBox = { west: 103.605, south: 1.159, east: 104.088, north: 1.471 };

const KM_PER_DEG_LAT = 110.574;
const KM_PER_DEG_LON = 111.32 * Math.cos((1.35 * Math.PI) / 180);
const PAD_KM = 10;

/** Region of interest: Singapore extended 10 km in every direction. */
export const REGION_BBOX: BBox = {
  west: SINGAPORE_BBOX.west - PAD_KM / KM_PER_DEG_LON,
  east: SINGAPORE_BBOX.east + PAD_KM / KM_PER_DEG_LON,
  south: SINGAPORE_BBOX.south - PAD_KM / KM_PER_DEG_LAT,
  north: SINGAPORE_BBOX.north + PAD_KM / KM_PER_DEG_LAT
};

export const SINGAPORE_CENTER = { lon: 103.8198, lat: 1.3521 };

/** NEA publishes one scan every 5 minutes. */
export const FRAME_MINUTES = 5;
export const FRAME_MS = FRAME_MINUTES * 60_000;

/** Full extent NEA publishes — the app's coverage area. */
export const COVERAGE_BBOX: BBox = RADAR_BBOX['480km'];

/** History kept for playback and analysis (2 hours of scans per range). */
export const HISTORY_FRAMES = 25;

/** Forecast horizons. */
export const DISPLAY_FORECAST_STEPS = 12; // +60 min of animated forecast imagery
export const POINT_FORECAST_STEPS = 36; // +180 min of point forecast
export const NOWCAST_STEPS = 6; // the "next 30 minutes" window

/** Default analysis grid cell edge, metres (aligned to the SVY21 national grid). */
export const DEFAULT_CELL_M = 50;
