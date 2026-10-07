/**
 * Animated flow particles drawn over the map, driven by the tracked echo
 * motion field — the "wind made visible" layer.
 */
import type { Map as MLMap } from 'maplibre-gl';
import { RADAR_BBOX } from '../config';
import { geoToPixel, kmPerPixel, motionAt } from '../radar/frameMath';
import type { MotionField } from '../radar/types';

interface Particle {
  x: number;
  y: number;
  age: number;
  life: number;
}

const CELL = 24; // screen-space velocity lattice spacing

export class WindLayer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private particles: Particle[] = [];
  /** Motion fields, finest range first. */
  private fields: MotionField[] = [];
  private vel: Float32Array = new Float32Array(0);
  private cols = 0;
  private rows = 0;
  private raf = 0;
  private running = false;
  private visible = true;
  private dpr = 1;
  private tint = '167,139,250';

  constructor(private map: MLMap, parent: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'wind-canvas';
    parent.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    const reset = () => this.rebuild();
    map.on('movestart', () => this.clear());
    map.on('moveend', reset);
    map.on('resize', reset);
    document.addEventListener('visibilitychange', () => (document.hidden ? this.stop() : this.start()));
    this.rebuild();
  }

  setTheme(dark: boolean) {
    this.tint = dark ? '167,139,250' : '79,70,229';
  }

  setFields(fields: MotionField[]) {
    this.fields = fields;
    this.rebuild();
  }

  setVisible(v: boolean) {
    this.visible = v;
    this.canvas.style.opacity = v ? '1' : '0';
    if (v) this.start();
    else this.stop();
  }

  private clear() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.canvas.classList.add('is-moving');
  }

  private rebuild() {
    const el = this.map.getContainer();
    const w = el.clientWidth;
    const h = el.clientHeight;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.canvas.classList.remove('is-moving');
    this.cols = Math.ceil(w / CELL) + 1;
    this.rows = Math.ceil(h / CELL) + 1;
    this.vel = new Float32Array(this.cols * this.rows * 2);
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const ll = this.map.unproject([c * CELL, r * CELL]);
        const i = (r * this.cols + c) * 2;
        for (const f of this.fields) {
          const p = geoToPixel(RADAR_BBOX[f.range], f.width, f.height, ll.lat, ll.lng);
          if (p.x < 0 || p.y < 0 || p.x >= f.width || p.y >= f.height) continue;
          const { kx, ky } = kmPerPixel(f.range, f.width);
          const [u, v] = motionAt(f, p.x, p.y);
          // km per 5 min → screen px per animation frame (stylised but proportional).
          this.vel[i] = u * kx * 0.9;
          this.vel[i + 1] = v * ky * 0.9;
          break;
        }
      }
    }
    const target = Math.round(Math.min(520, (w * h) / 2600));
    this.particles = Array.from({ length: target }, () => this.spawn(w, h, true));
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.start();
  }

  private spawn(w: number, h: number, randomAge = false): Particle {
    const life = 90 + Math.random() * 140;
    return { x: Math.random() * w, y: Math.random() * h, age: randomAge ? Math.random() * life : 0, life };
  }

  private sample(x: number, y: number): [number, number] {
    const gx = x / CELL;
    const gy = y / CELL;
    const c = Math.max(0, Math.min(this.cols - 2, Math.floor(gx)));
    const r = Math.max(0, Math.min(this.rows - 2, Math.floor(gy)));
    const tx = gx - c, ty = gy - r;
    const i00 = (r * this.cols + c) * 2, i10 = i00 + 2, i01 = i00 + this.cols * 2, i11 = i01 + 2;
    const V = this.vel;
    return [
      V[i00] * (1 - tx) * (1 - ty) + V[i10] * tx * (1 - ty) + V[i01] * (1 - tx) * ty + V[i11] * tx * ty,
      V[i00 + 1] * (1 - tx) * (1 - ty) + V[i10 + 1] * tx * (1 - ty) + V[i01 + 1] * (1 - tx) * ty + V[i11 + 1] * tx * ty
    ];
  }

  start() {
    if (this.running || !this.visible || !this.fields.length || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    this.running = true;
    const step = () => {
      if (!this.running) return;
      this.frame();
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private frame() {
    const { ctx, dpr } = this;
    const w = this.canvas.width / dpr;
    const h = this.canvas.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Fade previous trails.
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = 'rgba(0,0,0,0.045)';
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';
    ctx.lineWidth = 0.9;
    ctx.lineCap = 'round';
    for (const p of this.particles) {
      const [u, v] = this.sample(p.x, p.y);
      const speed = Math.hypot(u, v);
      const nx = p.x + u;
      const ny = p.y + v;
      const lifeT = p.age / p.life;
      const alpha = Math.sin(Math.PI * Math.min(1, lifeT)) * Math.min(0.6, 0.18 + speed * 0.3);
      if (speed > 0.02) {
        ctx.strokeStyle = `rgba(${this.tint},${alpha.toFixed(3)})`;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(nx, ny);
        ctx.stroke();
      }
      p.x = nx;
      p.y = ny;
      p.age++;
      if (p.age > p.life || nx < -10 || ny < -10 || nx > w + 10 || ny > h + 10) Object.assign(p, this.spawn(w, h));
    }
  }
}
