import type { BBox, RadarRange } from '../config';

export interface RadarFrame {
  range: RadarRange;
  /** Scan time, epoch ms. */
  time: number;
  width: number;
  height: number;
  /** Legend level per pixel, 0 = no echo. Row 0 is the northern edge. */
  levels: Uint8Array;
  bbox: BBox;
}

/** Motion field on a coarse block grid, in native pixels per 5 minutes. */
export interface MotionField {
  range: RadarRange;
  cols: number;
  rows: number;
  /** Pixel size of one block-grid step. */
  step: number;
  /** Image dimensions the field refers to. */
  width: number;
  height: number;
  u: Float32Array; // +x = east
  v: Float32Array; // +y = south (image rows)
  valid: Uint8Array;
  /** Domain-wide steering vector. */
  globalU: number;
  globalV: number;
  /** 0..1 — how much trust the tracker has in the vectors. */
  confidence: number;
  /** Fraction of blocks with a usable vector. */
  coverage: number;
}

export interface WindEstimate {
  /** Direction the wind blows FROM, degrees (meteorological). */
  fromDeg: number;
  speedKmh: number;
  confidence: number;
  source: RadarRange | 'none';
  /** Local steering at the spot, if available. */
  localFromDeg?: number;
  localSpeedKmh?: number;
}

export interface ForecastStep {
  /** Minutes ahead of the latest scan. */
  lead: number;
  /** Probability (0..1) of rain at the spot. */
  prob: number;
  /** Expected rate (mm/h) if it rains. */
  rate: number;
  /** Range used to produce this step. */
  source: RadarRange;
}

export interface UpstreamRain {
  distanceKm: number;
  bearingDeg: number;
  etaMin: number | null;
  rate: number;
}

export interface NearestRain {
  distanceKm: number;
  bearingDeg: number;
  rate: number;
}

export interface PointForecast {
  lat: number;
  lon: number;
  /** Scan time the forecast is issued from. */
  issued: number;
  nowRate: number;
  nowLevel: number;
  /** Clutter flagged at this location (stationary non-weather echo). */
  clutter: boolean;
  steps: ForecastStep[];
  upstream: UpstreamRain | null;
  nearest: NearestRain | null;
  /** Echo-coverage trend over the last 30 min: >1 growing, <1 decaying. */
  trend: number;
  wind: WindEstimate;
}

export interface AnalysisSummary {
  issued: number;
  wind: WindEstimate;
  trend: number;
  /** Fraction of the region of interest currently under rain. */
  regionCoverage: number;
  motion: Partial<Record<RadarRange, MotionField | null>>;
}
