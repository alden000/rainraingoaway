import { haptic } from '../lib/haptics';

const open = new Set<HTMLElement>();

export function openModal(el: HTMLElement, onClose?: () => void): void {
  if (open.has(el)) return;
  el.hidden = false;
  el.classList.remove('is-closing');
  open.add(el);
  const close = () => closeModal(el);
  el.querySelectorAll<HTMLElement>('[data-close]').forEach((c) => (c.onclick = close));
  (el as HTMLElement & { _onClose?: () => void })._onClose = onClose;
}

export function closeModal(el: HTMLElement): void {
  if (!open.has(el)) return;
  open.delete(el);
  haptic('selection');
  el.classList.add('is-closing');
  setTimeout(() => {
    el.hidden = true;
    el.classList.remove('is-closing');
  }, 380);
  (el as HTMLElement & { _onClose?: () => void })._onClose?.();
}

export function closeTopModal(): boolean {
  const last = [...open].pop();
  if (!last) return false;
  closeModal(last);
  return true;
}

export function anyModalOpen(): boolean {
  return open.size > 0;
}
