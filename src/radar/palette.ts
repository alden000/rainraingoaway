/**
 * NEA rain-radar legend. Each colour in the PNG maps to one of 33 intensity
 * levels (1 = faintest drizzle, 33 = extreme). We convert levels to an
 * approximate rain rate (mm/h) so analysis can work on a physical quantity.
 */

export const NEA_COLORS: ReadonlyArray<readonly [number, number, number]> = [
  [0, 255, 255], [0, 239, 239], [0, 209, 213], [0, 186, 191], [0, 151, 154], [0, 131, 125],
  [0, 128, 69], [0, 137, 56], [0, 162, 53], [0, 183, 41], [0, 202, 17],
  [0, 218, 13], [0, 245, 7], [0, 255, 0], [67, 255, 65], [72, 255, 70],
  [255, 255, 59], [255, 255, 0], [255, 240, 0], [255, 220, 0],
  [255, 198, 0], [255, 178, 0], [255, 165, 0], [255, 138, 0], [255, 114, 0],
  [255, 73, 0], [255, 31, 0], [229, 0, 0], [193, 0, 0], [182, 0, 106], [210, 0, 165], [212, 0, 170], [255, 0, 255]
];

export const LEVEL_COUNT = NEA_COLORS.length; // 33

export type IntensityClass = 'none' | 'light' | 'light-moderate' | 'moderate' | 'moderate-heavy' | 'heavy';

/** Category boundaries from the official legend (1-based level, inclusive upper bound). */
const CLASS_BOUNDS: Array<[number, IntensityClass]> = [
  [11, 'light'],
  [16, 'light-moderate'],
  [20, 'moderate'],
  [25, 'moderate-heavy'],
  [33, 'heavy']
];

export function levelClass(level: number): IntensityClass {
  if (level <= 0) return 'none';
  for (const [upper, cls] of CLASS_BOUNDS) if (level <= upper) return cls;
  return 'heavy';
}

/** Anchor points (level → mm/h); interpolated geometrically in between. */
const RATE_ANCHORS: Array<[number, number]> = [
  [1, 0.2], [11, 1.5], [16, 4], [20, 10], [25, 25], [33, 120]
];

const LEVEL_RATE = new Float32Array(LEVEL_COUNT + 1);
for (let l = 1; l <= LEVEL_COUNT; l++) {
  let i = 0;
  while (i < RATE_ANCHORS.length - 2 && l > RATE_ANCHORS[i + 1][0]) i++;
  const [l0, r0] = RATE_ANCHORS[i];
  const [l1, r1] = RATE_ANCHORS[i + 1];
  const t = (l - l0) / (l1 - l0);
  LEVEL_RATE[l] = r0 * Math.pow(r1 / r0, t);
}

export function levelToRate(level: number): number {
  return LEVEL_RATE[level] ?? 0;
}

/** Inverse of levelToRate: the highest level whose rate does not exceed `rate`. */
export function rateToLevel(rate: number): number {
  if (rate < LEVEL_RATE[1] * 0.5) return 0;
  let lo = 1;
  let hi = LEVEL_COUNT;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (LEVEL_RATE[mid] <= rate) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Rate threshold (mm/h) above which a location is considered "raining". */
export const RAIN_THRESHOLD = 0.1;

export function rateClass(rate: number): IntensityClass {
  if (rate < RAIN_THRESHOLD) return 'none';
  return levelClass(Math.max(1, rateToLevel(rate)));
}

export const CLASS_LABEL: Record<IntensityClass, string> = {
  none: 'No rain',
  light: 'Light rain',
  'light-moderate': 'Light–moderate rain',
  moderate: 'Moderate rain',
  'moderate-heavy': 'Moderate–heavy rain',
  heavy: 'Heavy rain'
};

export const CLASS_SHORT: Record<IntensityClass, string> = {
  none: 'Dry',
  light: 'Drizzle',
  'light-moderate': 'Showers',
  moderate: 'Rain',
  'moderate-heavy': 'Downpour',
  heavy: 'Torrential'
};

const rgbKey = (r: number, g: number, b: number) => (r << 16) | (g << 8) | b;

const COLOR_TO_LEVEL = new Map<number, number>();
NEA_COLORS.forEach(([r, g, b], i) => COLOR_TO_LEVEL.set(rgbKey(r, g, b), i + 1));

/** Map an arbitrary RGB colour to the closest legend level (memoised). */
export function colorToLevel(r: number, g: number, b: number): number {
  const key = rgbKey(r, g, b);
  const hit = COLOR_TO_LEVEL.get(key);
  if (hit !== undefined) return hit;
  let best = 0;
  let bestD = Infinity;
  NEA_COLORS.forEach(([pr, pg, pb], i) => {
    const d = (pr - r) ** 2 + (pg - g) ** 2 + (pb - b) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i + 1;
    }
  });
  // Very far from any legend colour (e.g. anti-aliased text) → ignore.
  const level = bestD > 60 * 60 ? 0 : best;
  COLOR_TO_LEVEL.set(key, level);
  return level;
}

/** Convert RGBA pixels into a level raster. */
export function rgbaToLevels(rgba: Uint8ClampedArray, out?: Uint8Array): Uint8Array {
  const n = rgba.length >> 2;
  const levels = out ?? new Uint8Array(n);
  // Most pixels are transparent, and neighbouring echoes repeat colours:
  // short-circuit both cases before the map lookup.
  let lastKey = -1;
  let lastLevel = 0;
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    if (rgba[p + 3] < 16) {
      levels[i] = 0;
      continue;
    }
    const key = (rgba[p] << 16) | (rgba[p + 1] << 8) | rgba[p + 2];
    if (key !== lastKey) {
      lastKey = key;
      lastLevel = colorToLevel(rgba[p], rgba[p + 1], rgba[p + 2]);
    }
    levels[i] = lastLevel;
  }
  return levels;
}

/* ------------------------------------------------------------------------- */
/* Display palettes                                                           */
/* ------------------------------------------------------------------------- */

export type PaletteId = 'signature' | 'classic';

type RGBA = [number, number, number, number];

/**
 * "Signature" ramp — a hand-tuned, luminous gradient that reads beautifully
 * over both the midnight and daylight basemaps: glacial teal → aqua → lime →
 * amber → coral → orchid. Alpha rises with intensity so drizzle stays airy.
 */
const SIGNATURE_STOPS: Array<[number, RGBA]> = [
  [1, [56, 189, 248, 110]],
  [6, [34, 211, 238, 150]],
  [11, [45, 212, 191, 175]],
  [16, [163, 230, 53, 195]],
  [20, [250, 204, 21, 210]],
  [25, [251, 146, 60, 225]],
  [29, [244, 63, 94, 235]],
  [33, [217, 70, 239, 245]]
];

function buildSignature(): RGBA[] {
  const out: RGBA[] = [[0, 0, 0, 0]];
  for (let l = 1; l <= LEVEL_COUNT; l++) {
    let i = 0;
    while (i < SIGNATURE_STOPS.length - 2 && l > SIGNATURE_STOPS[i + 1][0]) i++;
    const [l0, c0] = SIGNATURE_STOPS[i];
    const [l1, c1] = SIGNATURE_STOPS[i + 1];
    const t = Math.min(1, Math.max(0, (l - l0) / (l1 - l0)));
    out.push(c0.map((v, k) => Math.round(v + (c1[k] - v) * t)) as RGBA);
  }
  return out;
}

function buildClassic(): RGBA[] {
  return [[0, 0, 0, 0], ...NEA_COLORS.map(([r, g, b]) => [r, g, b, 200] as RGBA)];
}

const PALETTES: Record<PaletteId, RGBA[]> = { signature: buildSignature(), classic: buildClassic() };

/** Packed little-endian RGBA lookup (Uint32 per level) for fast rasterising. */
const PACKED: Record<PaletteId, Uint32Array> = {
  signature: pack(PALETTES.signature),
  classic: pack(PALETTES.classic)
};

function pack(p: RGBA[]): Uint32Array {
  const out = new Uint32Array(p.length);
  p.forEach(([r, g, b, a], i) => (out[i] = ((a << 24) | (b << 16) | (g << 8) | r) >>> 0));
  return out;
}

export function paletteColor(id: PaletteId, level: number): RGBA {
  return PALETTES[id][Math.max(0, Math.min(LEVEL_COUNT, level))];
}

export function packedPalette(id: PaletteId): Uint32Array {
  return PACKED[id];
}

export function cssColor(id: PaletteId, level: number, alpha?: number): string {
  const [r, g, b, a] = paletteColor(id, level);
  return `rgba(${r},${g},${b},${alpha ?? (a / 255).toFixed(3)})`;
}
