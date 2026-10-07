/**
 * The analysis grid: square cells aligned to Singapore's SVY21 national grid.
 * Cells are 50 m by default; when zoomed out the displayed grid coarsens so the
 * map stays readable, while the point analysis always uses the fine cell.
 *
 * For efficiency the grid is emitted as long grid *lines* plus filled
 * polygons only for wet cells, with horizontal runs of equal intensity merged.
 */
import type { Feature, FeatureCollection, LineString, Polygon } from 'geojson';
import { fromSVY21, toSVY21 } from '../lib/svy21';
import { RAIN_THRESHOLD, levelToRate, rateToLevel } from '../radar/palette';

export const GRID_SIZES = [5, 10, 25, 50, 100, 250, 500, 1000];
const MAX_LINES_PER_AXIS = 280;

export interface GridBuild {
  size: number;
  fc: FeatureCollection<Polygon | LineString, { r?: number }>;
}

export function buildGrid(
  bounds: { west: number; south: number; east: number; north: number },
  minSize: number,
  sampleRate: (lat: number, lon: number) => number
): GridBuild | null {
  const corners = [
    toSVY21(bounds.south, bounds.west),
    toSVY21(bounds.north, bounds.east),
    toSVY21(bounds.south, bounds.east),
    toSVY21(bounds.north, bounds.west)
  ];
  const minN = Math.min(...corners.map((c) => c.N));
  const maxN = Math.max(...corners.map((c) => c.N));
  const minE = Math.min(...corners.map((c) => c.E));
  const maxE = Math.max(...corners.map((c) => c.E));

  const size = GRID_SIZES.find(
    (s) => s >= minSize && (maxN - minN) / s <= MAX_LINES_PER_AXIS && (maxE - minE) / s <= MAX_LINES_PER_AXIS
  );
  if (!size) return null;

  const n0 = Math.floor(minN / size) * size;
  const e0 = Math.floor(minE / size) * size;
  const rows = Math.ceil((maxN - n0) / size);
  const cols = Math.ceil((maxE - e0) / size);

  // Vertex lattice is affine to within millimetres over a viewport, so we
  // project three anchors and interpolate rather than inverting every corner.
  const o = fromSVY21(n0, e0);
  const ex = fromSVY21(n0, e0 + size);
  const ny = fromSVY21(n0 + size, e0);
  const dLonE = ex.lon - o.lon, dLatE = ex.lat - o.lat;
  const dLonN = ny.lon - o.lon, dLatN = ny.lat - o.lat;
  const at = (r: number, c: number): [number, number] => [o.lon + c * dLonE + r * dLonN, o.lat + c * dLatE + r * dLatN];

  const features: GridBuild['fc']['features'] = [];
  for (let r = 0; r <= rows; r++) {
    features.push(line(at(r, 0), at(r, cols)));
  }
  for (let c = 0; c <= cols; c++) {
    features.push(line(at(0, c), at(rows, c)));
  }

  // Wet cells, merged into horizontal runs of identical intensity level.
  for (let r = 0; r < rows; r++) {
    let runStart = -1;
    let runLevel = 0;
    const flush = (end: number) => {
      if (runStart < 0) return;
      const ring = [at(r, runStart), at(r, end), at(r + 1, end), at(r + 1, runStart), at(r, runStart)];
      features.push({ type: 'Feature', properties: { r: levelToRate(runLevel) }, geometry: { type: 'Polygon', coordinates: [ring] } });
      runStart = -1;
    };
    for (let c = 0; c < cols; c++) {
      const [lon, lat] = at(r + 0.5, c + 0.5);
      const rate = sampleRate(lat, lon);
      const level = rate >= RAIN_THRESHOLD ? Math.max(1, rateToLevel(rate)) : 0;
      if (level !== runLevel || level === 0) {
        flush(c);
        if (level > 0) runStart = c;
        runLevel = level;
      }
    }
    flush(cols);
  }
  return { size, fc: { type: 'FeatureCollection', features } };
}

function line(a: [number, number], b: [number, number]): Feature<LineString, { r?: number }> {
  return { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [a, b] } };
}
