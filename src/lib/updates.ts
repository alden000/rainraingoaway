/**
 * Detects when a newer build has been deployed and offers a one-tap update.
 * Each deploy publishes version.json; we compare it with the build baked into
 * this bundle. Updating drops the offline app cache and service worker (radar
 * history in IndexedDB is kept) and reloads, so a stale copy can never stick.
 */
import { haptic } from './haptics';

const CHECK_EVERY_MS = 15 * 60_000;
let shown = false;

async function latestBuild(): Promise<string | null> {
  try {
    const res = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const json = (await res.json()) as { build?: string };
    return json.build ?? null;
  } catch {
    return null; // offline — try again later
  }
}

export async function applyUpdate(): Promise<void> {
  try {
    const regs = (await navigator.serviceWorker?.getRegistrations?.()) ?? [];
    await Promise.all(regs.map((r) => r.unregister()));
    if ('caches' in window) {
      const keys = await caches.keys();
      // Keep basemap tile caches; drop the app shell so the new build loads.
      await Promise.all(keys.filter((k) => !k.startsWith('basemap')).map((k) => caches.delete(k)));
    }
  } finally {
    location.reload();
  }
}

function showBanner(): void {
  if (shown) return;
  shown = true;
  const el = document.createElement('div');
  el.className = 'update-banner glass';
  el.setAttribute('role', 'status');
  el.innerHTML = `<span><strong>New version available</strong><small>Update to get the latest RainRain</small></span>
    <button class="update-banner__later" aria-label="Later">Later</button>
    <button class="update-banner__go" data-haptic="success">Update</button>`;
  document.body.appendChild(el);
  haptic('medium');
  el.querySelector<HTMLButtonElement>('.update-banner__go')!.addEventListener('click', () => {
    el.classList.add('is-busy');
    void applyUpdate();
  });
  el.querySelector<HTMLButtonElement>('.update-banner__later')!.addEventListener('click', () => {
    el.classList.add('is-leaving');
    setTimeout(() => el.remove(), 400);
    // Ask again on the next check.
    setTimeout(() => (shown = false), CHECK_EVERY_MS);
  });
}

async function check(): Promise<void> {
  if (__BUILD_SHA__ === 'dev' || document.hidden) return;
  const latest = await latestBuild();
  if (latest && latest !== __BUILD_SHA__) showBanner();
}

export function watchForUpdates(): void {
  void check();
  setInterval(() => void check(), CHECK_EVERY_MS);
  document.addEventListener('visibilitychange', () => !document.hidden && void check());
  window.addEventListener('online', () => void check());
}
