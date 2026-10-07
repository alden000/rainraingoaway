/**
 * Pure numerical helpers shared by the analysis worker and the main thread.
 * Everything here is allocation-light and works on plain typed arrays.
 */
import { RADAR_BBOX, type BBox, type RadarRange } from '../config';
import { levelToRate, LEVEL_COUNT } from './palette';
import type { MotionField, RadarFrame } from './types';

export const RATE_LUT = (() => {
  const lut = new Float32Array(256);
  for (let l = 1; l <= LEVEL_COUNT; l++) lut[l] = levelToRate(l);
  return lut;
})();

/** Image pixel coordinate (fractional, pixel centres at .5) for a lat/lon. */
export function geoToPixel(bbox: BBox, width: number, height: number, lat: number, lon: number) {
  return {
    x: ((lon - bbox.west) / (bbox.east - bbox.west)) * width,
    y: ((bbox.north - lat) / (bbox.north - bbox.south)) * height
  };
}

export function pixelToGeo(bbox: BBox, width: number, height: number, x: number, y: number) {
  return {
    lon: bbox.west + (x / width) * (bbox.east - bbox.west),
    lat: bbox.north - (y / height) * (bbox.north - bbox.south)
  };
}

export function kmPerPixel(range: RadarRange, width: number): { kx: number; ky: number } {
  const b = RADAR_BBOX[range];
  const midLat = (b.north + b.south) / 2;
  return {
    kx: ((b.east - b.west) * 111.32 * Math.cos((midLat * Math.PI) / 180)) / width,
    ky: ((b.north - b.south) * 110.574) / width
  };
}

/**
 * Bilinear rain rate (mm/h) at a fractional pixel position, treating each
 * pixel value as located at its centre. Gives a smooth field suitable for
 * the 5 m analysis grid while staying faithful to the native radar pixels.
 */
export function sampleRate(levels: Uint8Array, width: number, height: number, x: number, y: number, mask?: Uint8Array | null): number {
  const fx = x - 0.5;
  const fy = y - 0.5;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  let acc = 0;
  for (let j = 0; j <= 1; j++) {
    const yy = y0 + j;
    if (yy < 0 || yy >= height) continue;
    const wy = j ? ty : 1 - ty;
    for (let i = 0; i <= 1; i++) {
      const xx = x0 + i;
      if (xx < 0 || xx >= width) continue;
      const idx = yy * width + xx;
      if (mask && mask[idx]) continue;
      acc += RATE_LUT[levels[idx]] * wy * (i ? tx : 1 - tx);
    }
  }
  return acc;
}

export function nearestLevel(levels: Uint8Array, width: number, height: number, x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  if (xi < 0 || yi < 0 || xi >= width || yi >= height) return 0;
  return levels[yi * width + xi];
}

/** Bilinear interpolation of the motion field at a native pixel position. */
export function motionAt(field: MotionField, x: number, y: number): [number, number] {
  const gx = Math.min(field.cols - 1, Math.max(0, x / field.step - 0.5));
  const gy = Math.min(field.rows - 1, Math.max(0, y / field.step - 0.5));
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const x1 = Math.min(field.cols - 1, x0 + 1);
  const y1 = Math.min(field.rows - 1, y0 + 1);
  const tx = gx - x0;
  const ty = gy - y0;
  const i00 = y0 * field.cols + x0;
  const i10 = y0 * field.cols + x1;
  const i01 = y1 * field.cols + x0;
  const i11 = y1 * field.cols + x1;
  const w00 = (1 - tx) * (1 - ty);
  const w10 = tx * (1 - ty);
  const w01 = (1 - tx) * ty;
  const w11 = tx * ty;
  return [
    field.u[i00] * w00 + field.u[i10] * w10 + field.u[i01] * w01 + field.u[i11] * w11,
    field.v[i00] * w00 + field.v[i10] * w10 + field.v[i01] * w01 + field.v[i11] * w11
  ];
}

/** Motion vector (px / 5 min) → meteorological wind (from-direction, km/h). */
export function vectorToWind(range: RadarRange, width: number, u: number, v: number) {
  const { kx, ky } = kmPerPixel(range, width);
  const east = u * kx * 12; // km/h
  const north = -v * ky * 12;
  const speedKmh = Math.hypot(east, north);
  const towardDeg = (Math.atan2(east, north) * 180) / Math.PI;
  const fromDeg = (towardDeg + 180 + 360) % 360;
  return { speedKmh, fromDeg, towardDeg: (towardDeg + 360) % 360 };
}

export function frameBBox(frame: RadarFrame): BBox {
  return frame.bbox;
}
