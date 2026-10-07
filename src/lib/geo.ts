const R = 6371.0088;
const RAD = Math.PI / 180;

export interface LatLon {
  lat: number;
  lon: number;
}

export function distanceKm(a: LatLon, b: LatLon): number {
  const dLat = (b.lat - a.lat) * RAD;
  const dLon = (b.lon - a.lon) * RAD;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Initial bearing from a to b, degrees clockwise from north. */
export function bearingDeg(a: LatLon, b: LatLon): number {
  const y = Math.sin((b.lon - a.lon) * RAD) * Math.cos(b.lat * RAD);
  const x =
    Math.cos(a.lat * RAD) * Math.sin(b.lat * RAD) -
    Math.sin(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.cos((b.lon - a.lon) * RAD);
  return (Math.atan2(y, x) / RAD + 360) % 360;
}

const POINTS_16 = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const NAMES_8 = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];

export function compassPoint(deg: number): string {
  return POINTS_16[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
}

export function compassName(deg: number): string {
  return NAMES_8[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

export function inBBox(p: LatLon, b: { west: number; east: number; south: number; north: number }): boolean {
  return p.lon >= b.west && p.lon <= b.east && p.lat >= b.south && p.lat <= b.north;
}

export function formatCoord(p: LatLon): string {
  const ns = p.lat >= 0 ? 'N' : 'S';
  const ew = p.lon >= 0 ? 'E' : 'W';
  return `${Math.abs(p.lat).toFixed(4)}° ${ns}  ${Math.abs(p.lon).toFixed(4)}° ${ew}`;
}
