/**
 * Mobile bottom sheet with three detents (peek / half / full), rubber-banding
 * and velocity-aware snapping — the native-app feel on the web.
 */
import { haptic } from '../lib/haptics';

export type Detent = 'peek' | 'half' | 'full';

export class BottomSheet {
  private detent: Detent = 'peek';
  private y = 0; // current translateY (px)
  private enabled = false;
  private mq = matchMedia('(max-width: 899px)');
  private listeners = new Set<(d: Detent) => void>();

  constructor(private panel: HTMLElement, private scroller: HTMLElement, private grabber: HTMLElement, private peekEl: HTMLElement) {
    this.mq.addEventListener('change', () => this.sync());
    window.addEventListener('resize', () => this.layout(false));
    new ResizeObserver(() => this.layout(false)).observe(peekEl);
    this.bind();
    this.sync();
  }

  onChange(fn: (d: Detent) => void) {
    this.listeners.add(fn);
  }

  private sync() {
    this.enabled = this.mq.matches;
    if (!this.enabled) {
      this.panel.style.removeProperty('--sheet-y');
      document.documentElement.style.removeProperty('--sheet-visible');
      this.panel.classList.remove('is-full');
      return;
    }
    this.layout(false);
  }

  private height() {
    return this.panel.getBoundingClientRect().height || window.innerHeight * 0.9;
  }

  private visibleFor(d: Detent) {
    const H = this.height();
    const peek = Math.min(H * 0.55, this.grabber.offsetHeight + this.peekEl.offsetHeight + 14);
    if (d === 'peek') return peek;
    if (d === 'half') return Math.max(peek + 80, H * 0.62);
    return H;
  }

  private apply(y: number) {
    this.y = y;
    const H = this.height();
    this.panel.style.setProperty('--sheet-y', `${y}px`);
    document.documentElement.style.setProperty('--sheet-visible', `${Math.max(0, H - y)}px`);
  }

  layout(animate = true) {
    if (!this.enabled) return;
    if (!animate) this.panel.classList.add('is-dragging');
    this.apply(this.height() - this.visibleFor(this.detent));
    this.panel.classList.toggle('is-full', this.detent === 'full');
    document.getElementById('app')?.classList.toggle('sheet-full', this.detent === 'full');
    if (!animate) requestAnimationFrame(() => this.panel.classList.remove('is-dragging'));
  }

  snap(d: Detent, feedback = true) {
    if (!this.enabled) return;
    const changed = d !== this.detent;
    this.detent = d;
    if (d !== 'full') this.scroller.scrollTo({ top: 0, behavior: 'smooth' });
    this.layout(true);
    if (changed) {
      if (feedback) haptic(d === 'full' ? 'medium' : 'light');
      this.listeners.forEach((l) => l(d));
    }
  }

  get current(): Detent {
    return this.detent;
  }

  private bind() {
    let startY = 0;
    let startSheet = 0;
    let dragging = false;
    let armed = false;
    let lastY = 0;
    let lastT = 0;
    let velocity = 0;
    let pointerId = -1;

    const down = (e: PointerEvent) => {
      if (!this.enabled || e.button > 0) return;
      const onGrabber = this.grabber.contains(e.target as Node);
      const full = this.detent === 'full';
      if (full && !onGrabber && this.scroller.scrollTop > 0) return;
      armed = true;
      dragging = false;
      pointerId = e.pointerId;
      startY = lastY = e.clientY;
      lastT = performance.now();
      startSheet = this.y;
      velocity = 0;
    };

    const move = (e: PointerEvent) => {
      if (!armed || e.pointerId !== pointerId) return;
      const dy = e.clientY - startY;
      if (!dragging) {
        if (Math.abs(dy) < 7) return;
        // In full state, only a downward pull from the top collapses the sheet.
        if (this.detent === 'full' && dy < 0 && !this.grabber.contains(e.target as Node)) {
          armed = false;
          return;
        }
        dragging = true;
        this.panel.classList.add('is-dragging');
        this.panel.setPointerCapture?.(pointerId);
      }
      const H = this.height();
      const minY = 0;
      const maxY = H - this.visibleFor('peek');
      let y = startSheet + dy;
      // Rubber band beyond the extremes.
      if (y < minY) y = minY - Math.pow(minY - y, 0.7);
      if (y > maxY) y = maxY + Math.pow(y - maxY, 0.7);
      this.apply(y);
      const now = performance.now();
      velocity = (e.clientY - lastY) / Math.max(1, now - lastT);
      lastY = e.clientY;
      lastT = now;
      e.preventDefault();
    };

    const up = (e: PointerEvent) => {
      if (!armed || e.pointerId !== pointerId) return;
      armed = false;
      if (!dragging) return;
      dragging = false;
      this.panel.classList.remove('is-dragging');
      const H = this.height();
      const projected = this.y + velocity * 220;
      const order: Detent[] = ['full', 'half', 'peek'];
      let best: Detent = this.detent;
      let bestD = Infinity;
      for (const d of order) {
        const dist = Math.abs(H - this.visibleFor(d) - projected);
        if (dist < bestD) {
          bestD = dist;
          best = d;
        }
      }
      // Flicks always move at least one detent in the flick direction.
      if (Math.abs(velocity) > 0.6 && best === this.detent) {
        const i = order.indexOf(this.detent);
        best = order[Math.max(0, Math.min(order.length - 1, i + (velocity > 0 ? 1 : -1)))];
      }
      if (best === this.detent) this.layout(true);
      else this.snap(best);
      // Swallow the click that follows a drag.
      const swallow = (ev: Event) => {
        ev.stopPropagation();
        ev.preventDefault();
      };
      window.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 50);
    };

    this.panel.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    this.grabber.addEventListener('click', () => this.snap(this.detent === 'peek' ? 'half' : this.detent === 'half' ? 'full' : 'peek'));
  }
}
