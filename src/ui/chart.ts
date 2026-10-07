/**
 * Three-hour outlook: smoothed probability area + intensity bars, with a
 * scrubbable cursor that ticks haptically as it crosses 5-minute steps.
 */
import { haptic } from '../lib/haptics';
import { clock, rateText } from '../radar/insights';
import { CLASS_LABEL, cssColor, rateClass, rateToLevel, type PaletteId } from '../radar/palette';
import type { ForecastStep } from '../radar/types';

const H = 150;
const PAD = { l: 26, r: 8, t: 14, b: 22 };

let uid = 0;

export class OutlookChart {
  private el: HTMLElement;
  private svg: SVGSVGElement | null = null;
  private tip: HTMLElement;
  private steps: ForecastStep[] = [];
  private issued = 0;
  private width = 360;
  private id = ++uid;
  private palette: PaletteId = 'signature';
  private lastIdx = -1;

  constructor(el: HTMLElement) {
    this.el = el;
    this.tip = document.createElement('div');
    this.tip.className = 'chart-tip';
    new ResizeObserver(() => {
      const w = this.el.clientWidth;
      if (w && Math.abs(w - this.width) > 2) {
        this.width = w;
        this.render(false);
      }
    }).observe(el);
    this.bindScrub();
  }

  setPalette(p: PaletteId) {
    this.palette = p;
    this.render(false);
  }

  update(steps: ForecastStep[], issued: number) {
    this.steps = steps;
    this.issued = issued;
    this.render(true);
  }

  private x(lead: number) {
    const maxLead = this.steps[this.steps.length - 1]?.lead || 180;
    return PAD.l + (lead / maxLead) * (this.width - PAD.l - PAD.r);
  }

  private y(p: number) {
    return PAD.t + (1 - p) * (H - PAD.t - PAD.b);
  }

  private path(points: Array<[number, number]>) {
    // Monotone cubic (Fritsch–Carlson) for a smooth line without overshoot.
    const n = points.length;
    if (n < 2) return '';
    const dx: number[] = [], m: number[] = [], t: number[] = [];
    for (let i = 0; i < n - 1; i++) {
      dx[i] = points[i + 1][0] - points[i][0];
      m[i] = (points[i + 1][1] - points[i][1]) / dx[i];
    }
    t[0] = m[0];
    t[n - 1] = m[n - 2];
    for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
    let d = `M${points[0][0].toFixed(1)},${points[0][1].toFixed(1)}`;
    for (let i = 0; i < n - 1; i++) {
      const [x0, y0] = points[i];
      const [x1, y1] = points[i + 1];
      const h = dx[i] / 3;
      d += `C${(x0 + h).toFixed(1)},${(y0 + t[i] * h).toFixed(1)} ${(x1 - h).toFixed(1)},${(y1 - t[i + 1] * h).toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`;
    }
    return d;
  }

  private render(reveal: boolean) {
    const { steps, width: W } = this;
    if (!steps.length) return;
    const id = this.id;
    const pts = steps.map((s) => [this.x(s.lead), this.y(s.prob)] as [number, number]);
    const line = this.path(pts);
    const area = `${line}L${this.x(steps[steps.length - 1].lead)},${this.y(0)}L${this.x(0)},${this.y(0)}Z`;
    const bw = Math.max(2, (W - PAD.l - PAD.r) / steps.length - 2);
    const bars = steps
      .filter((s) => s.rate >= 0.1 && s.prob >= 0.05)
      .map((s) => {
        const h = Math.min(1, Math.log10(1 + s.rate) / Math.log10(51)) * (H - PAD.t - PAD.b) * 0.55;
        return `<rect x="${(this.x(s.lead) - bw / 2).toFixed(1)}" y="${(this.y(0) - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="1.5" fill="${cssColor(this.palette, rateToLevel(s.rate), 0.85)}" opacity="${(0.35 + 0.65 * s.prob).toFixed(2)}"/>`;
      })
      .join('');
    const grid = [0, 0.5, 1]
      .map((p) => `<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${this.y(p)}" y2="${this.y(p)}"/>`)
      .join('');
    const yLabels = [0, 0.5, 1].map((p) => `<text x="0" y="${this.y(p) + 3.5}">${p * 100}%</text>`).join('');
    const xLabels = [0, 30, 60, 120, 180]
      .filter((l) => l <= steps[steps.length - 1].lead)
      .map((l) => `<text x="${this.x(l)}" y="${H - 4}" text-anchor="middle">${l === 0 ? 'Now' : l < 60 ? `${l}m` : `${l / 60}h`}</text>`)
      .join('');
    const x30 = this.x(30);

    this.el.innerHTML = `
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Chance of rain over the next three hours">
        <defs>
          <linearGradient id="cg-fill-${id}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="var(--accent-2)" stop-opacity=".55"/>
            <stop offset="1" stop-color="var(--accent-2)" stop-opacity="0"/>
          </linearGradient>
          <linearGradient id="cg-line-${id}" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stop-color="var(--accent-1)"/><stop offset=".55" stop-color="var(--accent-2)"/><stop offset="1" stop-color="var(--accent-3)"/>
          </linearGradient>
          <clipPath id="cg-clip-${id}"><rect class="c-reveal" x="0" y="0" height="${H}" width="${reveal ? 0 : W}"/></clipPath>
        </defs>
        <g class="c-grid">${grid}</g>
        <rect x="${PAD.l}" y="${PAD.t}" width="${x30 - PAD.l}" height="${H - PAD.t - PAD.b}" fill="var(--accent-1)" opacity=".05"/>
        <g class="c-mark"><line x1="${x30}" x2="${x30}" y1="${PAD.t - 6}" y2="${this.y(0)}"/><text x="${x30 + 5}" y="${PAD.t - 2}">30 min</text></g>
        <g clip-path="url(#cg-clip-${id})">
          ${bars}
          <path class="c-area" d="${area}" fill="url(#cg-fill-${id})"/>
          <path class="c-line" d="${line}" stroke="url(#cg-line-${id})"/>
        </g>
        <g class="c-axis">${yLabels}${xLabels}</g>
        <g class="c-cursor"><line y1="${PAD.t}" y2="${this.y(0)}"/><circle r="5"/></g>
      </svg>`;
    this.el.appendChild(this.tip);
    this.svg = this.el.querySelector('svg');
    if (reveal) {
      const rect = this.el.querySelector<SVGRectElement>('.c-reveal')!;
      requestAnimationFrame(() => requestAnimationFrame(() => rect.setAttribute('width', String(W))));
    }
  }

  private bindScrub() {
    const show = (clientX: number) => {
      if (!this.svg || !this.steps.length) return;
      const r = this.el.getBoundingClientRect();
      const x = ((clientX - r.left) / r.width) * this.width;
      let idx = 0;
      let best = Infinity;
      this.steps.forEach((s, i) => {
        const d = Math.abs(this.x(s.lead) - x);
        if (d < best) {
          best = d;
          idx = i;
        }
      });
      const s = this.steps[idx];
      if (idx !== this.lastIdx) {
        haptic('selection');
        this.lastIdx = idx;
      }
      const cx = this.x(s.lead);
      const cy = this.y(s.prob);
      const cur = this.svg.querySelector('.c-cursor')!;
      cur.querySelector('line')!.setAttribute('x1', String(cx));
      cur.querySelector('line')!.setAttribute('x2', String(cx));
      cur.querySelector('circle')!.setAttribute('cx', String(cx));
      cur.querySelector('circle')!.setAttribute('cy', String(cy));
      const when = s.lead === 0 ? 'Now' : clock(this.issued + s.lead * 60_000);
      const what = s.prob < 0.05 ? 'Dry' : `${Math.round(s.prob * 100)}% · ${CLASS_LABEL[rateClass(s.rate)].replace(' rain', '')}${s.rate >= 0.1 ? ` · ${rateText(s.rate)}` : ''}`;
      this.tip.textContent = `${when} — ${what}`;
      this.tip.style.left = `${Math.max(70, Math.min(r.width - 70, (cx / this.width) * r.width))}px`;
      this.el.classList.add('is-scrubbing');
    };
    const hide = () => {
      this.el.classList.remove('is-scrubbing');
      this.lastIdx = -1;
    };
    this.el.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse') this.el.setPointerCapture(e.pointerId);
      show(e.clientX);
    });
    this.el.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'mouse' || this.el.hasPointerCapture(e.pointerId)) show(e.clientX);
    });
    this.el.addEventListener('pointerleave', (e) => e.pointerType === 'mouse' && hide());
    this.el.addEventListener('pointerup', (e) => e.pointerType !== 'mouse' && setTimeout(hide, 900));
    this.el.addEventListener('pointercancel', hide);
  }
}
