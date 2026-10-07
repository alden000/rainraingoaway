/**
 * Rasterises level grids with the chosen palette and composites the visible
 * state (with cross-fades between scans) into the canvas MapLibre displays.
 */
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

  constructor(size = 480) {
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
