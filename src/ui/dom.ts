import { icons, logoSVG } from './icons';

export const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document): T => {
  const el = root.querySelector<T>(sel);
  if (!el) throw new Error(`Missing element ${sel}`);
  return el;
};

export function hydrateIcons(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-icon]').forEach((el) => {
    const name = el.dataset.icon as keyof typeof icons;
    if (icons[name] && !el.firstElementChild) el.innerHTML = icons[name];
  });
  root.querySelectorAll<HTMLElement>('[data-logo]').forEach((el) => (el.innerHTML = logoSVG));
}

export function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

/** Animate a number in an element from its current value. */
const tweens = new WeakMap<HTMLElement, number>();
export function tweenNumber(el: HTMLElement, to: number, opts: { decimals?: number; duration?: number } = {}): void {
  const { decimals = 0, duration = 900 } = opts;
  const from = parseFloat(el.dataset.value ?? 'NaN');
  el.dataset.value = String(to);
  cancelAnimationFrame(tweens.get(el) ?? 0);
  if (!Number.isFinite(from) || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    el.textContent = to.toFixed(decimals);
    return;
  }
  const t0 = performance.now();
  const step = (now: number) => {
    const t = Math.min(1, (now - t0) / duration);
    const e = 1 - Math.pow(1 - t, 4);
    el.textContent = (from + (to - from) * e).toFixed(decimals);
    if (t < 1) tweens.set(el, requestAnimationFrame(step));
  };
  tweens.set(el, requestAnimationFrame(step));
}

/** Swap the text in a container with a vertical blur-slide transition. */
export function swapText(container: HTMLElement, text: string): void {
  const current = container.querySelector<HTMLElement>('span:not(.is-leaving)');
  if (current && current.textContent === text) return;
  const next = document.createElement('span');
  next.textContent = text;
  next.className = 'is-entering';
  if (current) {
    current.classList.add('is-leaving');
    setTimeout(() => current.remove(), 700);
  }
  container.appendChild(next);
  requestAnimationFrame(() => requestAnimationFrame(() => next.classList.remove('is-entering')));
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
