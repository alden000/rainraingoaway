/**
 * Rasterises level grids with the chosen palette and composites the visible
 * state (with cross-fades between scans) into the canvas MapLibre displays.
 */
import { RADAR_BBOX, RANGES, type RadarRange } from '../config';
import { packedPalette, type PaletteId } from '../radar/palette';

export interface DisplayFrame {
  time: number;
  levels: Uint8Array;
  width: number;
  height: number;
  forecast: boolean;
}

export class RadarRenderer {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private cache = new Map<string, HTMLCanvasElement>();
  private palette: PaletteId = 'signature';

  /** Pixel rect covered by the next finer range — cleared so layers don't double up. */
  private hole: { x0: number; y0: number; x1: number; y1: number } | null = null;

  constructor(readonly range: RadarRange, size = 480) {
    const inner = RANGES[RANGES.indexOf(range) - 1];
    if (inner) {
      const o = RADAR_BBOX[range];
      const i = RADAR_BBOX[inner];
      const fx = (lon: number) => ((lon - o.west) / (o.east - o.west)) * size;
      const fy = (lat: number) => ((o.north - lat) / (o.north - o.south)) * size;
      // Inset by a pixel so the finer layer overlaps the seam slightly.
      this.hole = { x0: Math.ceil(fx(i.west)) + 1, y0: Math.ceil(fy(i.north)) + 1, x1: Math.floor(fx(i.east)) - 1, y1: Math.floor(fy(i.south)) - 1 };
    }
    this.canvas = document.createElement('canvas');
    this.canvas.width = size;
    this.canvas.height = size;
    this.ctx = this.canvas.getContext('2d')!;
  }

  setPalette(p: PaletteId) {
    if (p === this.palette) return;
    this.palette = p;
    this.cache.clear();
  }

  /** Keep only rasters for the frames that still exist. */
  retain(frames: DisplayFrame[]) {
    const keep = new Set(frames.map((f) => this.key(f)));
    for (const k of this.cache.keys()) if (!keep.has(k)) this.cache.delete(k);
  }

  private key(f: DisplayFrame) {
    return `${this.palette}|${f.forecast ? 'f' : 'o'}|${f.time}`;
  }

  raster(f: DisplayFrame): HTMLCanvasElement {
    const k = this.key(f);
    let c = this.cache.get(k);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = f.width;
    c.height = f.height;
    const cx = c.getContext('2d')!;
    const img = cx.createImageData(f.width, f.height);
    const out = new Uint32Array(img.data.buffer);
    const pal = packedPalette(this.palette);
    const L = f.levels;
    for (let i = 0; i < L.length; i++) out[i] = pal[L[i]];
    cx.putImageData(img, 0, 0);
    if (this.hole) {
      const sx = f.width / this.canvas.width;
      const h = this.hole;
      cx.clearRect(h.x0 * sx, h.y0 * sx, (h.x1 - h.x0) * sx, (h.y1 - h.y0) * sx);
    }
    this.cache.set(k, c);
    return c;
  }

  /** Draw frame `a`, cross-faded towards `b` by t ∈ [0,1]. */
  draw(a: DisplayFrame | null, b: DisplayFrame | null = null, t = 0) {
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    if (a) {
      ctx.globalAlpha = b ? 1 - t : 1;
      ctx.drawImage(this.raster(a), 0, 0, canvas.width, canvas.height);
    }
    if (b && t > 0) {
      ctx.globalAlpha = t;
      ctx.drawImage(this.raster(b), 0, 0, canvas.width, canvas.height);
    }
    ctx.globalAlpha = 1;
  }
}
