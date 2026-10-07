import { icons } from './icons';

export function toast(message: string, opts: { icon?: keyof typeof icons; duration?: number } = {}): void {
  const host = document.getElementById('toasts');
  if (!host) return;
  // Avoid stacking duplicates.
  for (const t of host.children) if ((t as HTMLElement).dataset.msg === message) return;
  const el = document.createElement('div');
  el.className = 'toast glass';
  el.dataset.msg = message;
  el.innerHTML = `${icons[opts.icon ?? 'info']}<span></span>`;
  el.querySelector('span')!.textContent = message;
  host.appendChild(el);
  const remove = () => {
    el.classList.add('is-leaving');
    setTimeout(() => el.remove(), 350);
  };
  setTimeout(remove, opts.duration ?? 4200);
  el.addEventListener('click', remove);
}
