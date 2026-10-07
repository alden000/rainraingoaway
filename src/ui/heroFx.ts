/**
 * Ambient hero background: rain streaks whose density follows the live
 * intensity, or slow drifting motes when it is dry.
 */
interface Streak { x: number; y: number; len: number; speed: number; alpha: number }

export class HeroFx {
  private ctx: CanvasRenderingContext2D;
  private streaks: Streak[] = [];
  private intensity = 0; // 0..1
  private target = 0;
  private raf = 0;
  private w = 0;
  private h = 0;
  private dark = true;
  private visible = true;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    new ResizeObserver(() => this.resize()).observe(canvas);
    new IntersectionObserver(([e]) => {
      this.visible = e.isIntersecting;
      if (this.visible) this.loop();
    }).observe(canvas);
    document.addEventListener('visibilitychange', () => !document.hidden && this.loop());
    this.resize();
  }

  setTheme(dark: boolean) {
    this.dark = dark;
  }

  /** @param rate mm/h at the spot (0 = dry) */
  setRate(rate: number) {
    this.target = rate < 0.1 ? 0 : Math.min(1, 0.25 + Math.log10(1 + rate) / 1.6);
    this.loop();
  }

  private resize() {
    const dpr = Math.min(2, devicePixelRatio || 1);
    const r = this.canvas.getBoundingClientRect();
    this.w = r.width;
    this.h = r.height;
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private spawn(top = false): Streak {
    return {
      x: Math.random() * (this.w + 60) - 30,
      y: top ? -20 - Math.random() * 40 : Math.random() * this.h,
      len: 8 + Math.random() * 18,
      speed: 5 + Math.random() * 7,
      alpha: 0.15 + Math.random() * 0.35
    };
  }

  private loop() {
    if (this.raf || !this.visible || document.hidden) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const tick = () => {
      this.raf = 0;
      if (!this.visible || document.hidden) return;
      this.intensity += (this.target - this.intensity) * 0.03;
      this.draw();
      if (this.intensity > 0.005 || this.target > 0 || this.streaks.length) this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  private draw() {
    const { ctx, w, h } = this;
    ctx.clearRect(0, 0, w, h);
    const want = Math.round(this.intensity * 140);
    while (this.streaks.length < want) this.streaks.push(this.spawn(true));
    if (this.streaks.length > want) this.streaks.length = Math.max(want, this.streaks.length - 2);
    const tint = this.dark ? '186,230,253' : '14,116,144';
    ctx.lineCap = 'round';
    ctx.lineWidth = 1.2;
    for (const s of this.streaks) {
      const sp = s.speed * (0.7 + this.intensity * 0.8);
      ctx.strokeStyle = `rgba(${tint},${(s.alpha * Math.min(1, this.intensity * 1.6)).toFixed(3)})`;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(s.x - s.len * 0.18, s.y + s.len);
      ctx.stroke();
      s.y += sp;
      s.x -= sp * 0.18;
      if (s.y > h + 20) Object.assign(s, this.spawn(true));
    }
  }
}
