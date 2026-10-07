/** Small bespoke instruments: compass, nearby-rain scope, ring gauge, weather glyph. */
import type { IntensityClass } from '../radar/palette';

/* ---- Compass ------------------------------------------------------------ */
export function renderCompass(el: HTMLElement): void {
  const C = 68;
  let ticks = '';
  for (let i = 0; i < 72; i++) {
    const a = (i * 5 * Math.PI) / 180;
    const major = i % 18 === 0;
    const mid = i % 9 === 0;
    const r1 = 62, r2 = major ? 52 : mid ? 55 : 58;
    ticks += `<line class="${major ? 'major' : ''}" x1="${C + r1 * Math.sin(a)}" y1="${C - r1 * Math.cos(a)}" x2="${C + r2 * Math.sin(a)}" y2="${C - r2 * Math.cos(a)}" stroke-width="${major ? 1.6 : 1}"/>`;
  }
  const card = (t: string, deg: number, cls = '') => {
    const a = (deg * Math.PI) / 180;
    return `<text class="cardinal ${cls}" x="${C + 42 * Math.sin(a)}" y="${C - 42 * Math.cos(a) + 3.5}" text-anchor="middle">${t}</text>`;
  };
  el.innerHTML = `
    <svg viewBox="0 0 136 136" aria-hidden="true">
      <defs>
        <radialGradient id="cmp-face" cx="50%" cy="40%" r="60%">
          <stop offset="0" stop-color="var(--accent-2)" stop-opacity=".18"/><stop offset="1" stop-color="var(--accent-2)" stop-opacity="0"/>
        </radialGradient>
        <linearGradient id="cmp-needle" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stop-color="var(--accent-1)" stop-opacity="0"/><stop offset=".5" stop-color="var(--accent-1)"/><stop offset="1" stop-color="var(--accent-3)"/>
        </linearGradient>
      </defs>
      <circle cx="${C}" cy="${C}" r="66" fill="url(#cmp-face)" stroke="var(--line-strong)"/>
      <g class="ticks">${ticks}</g>
      ${card('N', 0, 'n')}${card('E', 90)}${card('S', 180)}${card('W', 270)}
      <g class="needle" style="transform: rotate(0deg)">
        <line class="needle-trail" x1="${C}" y1="${C + 30}" x2="${C}" y2="${C - 26}" stroke="url(#cmp-needle)" stroke-width="3" stroke-linecap="round" stroke-dasharray="4 4"/>
        <path d="M${C} ${C - 34} l9 15 h-18 z" fill="var(--accent-3)"/>
        <circle cx="${C}" cy="${C + 30}" r="4" fill="none" stroke="var(--accent-1)" stroke-width="2"/>
      </g>
      <circle cx="${C}" cy="${C}" r="4.5" fill="var(--ink)"/>
    </svg>`;
}

let lastNeedle = 0;
/** Point the needle the way the wind is blowing TO (continuous rotation path). */
export function setCompass(el: HTMLElement, towardDeg: number | null): void {
  const needle = el.querySelector<SVGGElement>('.needle');
  if (!needle) return;
  el.classList.toggle('is-unknown', towardDeg === null);
  if (towardDeg === null) return;
  let delta = ((towardDeg - lastNeedle) % 360 + 540) % 360 - 180;
  lastNeedle += delta;
  needle.style.transform = `rotate(${lastNeedle}deg)`;
}

/* ---- Scope (nearest rain) --------------------------------------------- */
export function renderScope(el: HTMLElement, blip: { distanceKm: number; bearingDeg: number; color: string } | null, maxKm = 60): void {
  const C = 60;
  let dot = '';
  if (blip) {
    const r = Math.min(1, Math.sqrt(blip.distanceKm / maxKm)) * 52;
    const a = (blip.bearingDeg * Math.PI) / 180;
    const x = C + r * Math.sin(a), y = C - r * Math.cos(a);
    dot = `<line x1="${C}" y1="${C}" x2="${x}" y2="${y}" stroke="${blip.color}" stroke-opacity=".5" stroke-dasharray="2 3"/>
      <circle class="blip" cx="${x}" cy="${y}" r="5" fill="${blip.color}" opacity=".6"/>
      <circle cx="${x}" cy="${y}" r="4.5" fill="${blip.color}"/>`;
  }
  const ringR = [5, 20, 60].map((km) => Math.sqrt(km / maxKm) * 52);
  el.innerHTML = `
    <svg viewBox="0 0 120 120" aria-hidden="true">
      <defs><linearGradient id="scope-sweep" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="var(--accent-1)" stop-opacity="0"/><stop offset="1" stop-color="var(--accent-1)" stop-opacity=".35"/></linearGradient></defs>
      <g class="rings">${ringR.map((r) => `<circle cx="${C}" cy="${C}" r="${r}"/>`).join('')}</g>
      <path class="sweep" d="M${C} ${C} L${C} ${C - 54} A54 54 0 0 1 ${C + 54 * Math.sin(0.9)} ${C - 54 * Math.cos(0.9)} Z" fill="url(#scope-sweep)"/>
      ${dot}
      <circle cx="${C}" cy="${C}" r="4" fill="#3b82f6" stroke="#fff" stroke-width="1.6"/>
    </svg>`;
}

/* ---- Ring gauge -------------------------------------------------------- */
export function renderRing(el: HTMLElement, value: number, color: string, label: string): void {
  const r = 24;
  const c = 2 * Math.PI * r;
  if (!el.querySelector('svg')) {
    el.innerHTML = `<svg viewBox="0 0 58 58"><circle class="track" cx="29" cy="29" r="${r}" fill="none" stroke-width="5"/>
      <circle class="val" cx="29" cy="29" r="${r}" fill="none" stroke-width="5" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c}"/>
      <text x="29" y="33.5" text-anchor="middle"></text></svg>`;
  }
  const val = el.querySelector<SVGCircleElement>('.val')!;
  requestAnimationFrame(() => {
    val.style.strokeDashoffset = String(c * (1 - Math.max(0.02, Math.min(1, value))));
    val.style.stroke = color;
  });
  el.querySelector('text')!.textContent = label;
}

/* ---- Weather glyph ----------------------------------------------------- */
export function renderGlyph(el: HTMLElement, cls: IntensityClass, watch: boolean, night: boolean): void {
  const key = `${cls}|${watch}|${night}`;
  if (el.dataset.key === key) return;
  el.dataset.key = key;
  const cloud = (fill: string, dy = 0) =>
    `<path class="g-cloud" transform="translate(0 ${dy})" d="M24 54h30a12 12 0 0 0 1.5-23.9A16 16 0 0 0 25 27.5 13.3 13.3 0 0 0 24 54Z" fill="${fill}" stroke="rgba(255,255,255,.35)" stroke-width="1"/>`;
  const drops = (n: number, color: string, len = 7) =>
    Array.from({ length: n }, (_, i) => {
      const x = 26 + i * (28 / Math.max(1, n - 1));
      return `<line class="g-drop" x1="${x}" y1="60" x2="${x - 2.5}" y2="${60 + len}" stroke="${color}" stroke-width="2.4" stroke-linecap="round"/>`;
    }).join('');
  let body = '';
  const defs = `<defs>
    <linearGradient id="gl-sun" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fde68a"/><stop offset="1" stop-color="#fb923c"/></linearGradient>
    <linearGradient id="gl-moon" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e0e7ff"/><stop offset="1" stop-color="#a5b4fc"/></linearGradient>
    <linearGradient id="gl-cloud" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e2e8f0"/><stop offset="1" stop-color="#94a3b8"/></linearGradient>
    <linearGradient id="gl-storm" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#94a3b8"/><stop offset="1" stop-color="#475569"/></linearGradient>
  </defs>`;
  const celestial = night
    ? `<path d="M44 14a16 16 0 1 0 14 22A13 13 0 0 1 44 14Z" fill="url(#gl-moon)"/>`
    : `<g class="g-sun"><circle cx="38" cy="30" r="12" fill="url(#gl-sun)"/>${Array.from({ length: 8 }, (_, i) => {
        const a = (i * Math.PI) / 4;
        return `<line x1="${38 + 17 * Math.cos(a)}" y1="${30 + 17 * Math.sin(a)}" x2="${38 + 22 * Math.cos(a)}" y2="${30 + 22 * Math.sin(a)}" stroke="#fbbf24" stroke-width="2.4" stroke-linecap="round"/>`;
      }).join('')}</g>`;
  switch (cls) {
    case 'none':
      body = watch ? `<g transform="translate(-8 -6)">${celestial}</g>${cloud('url(#gl-cloud)', 4)}` : celestial.replace(/38/g, '38');
      break;
    case 'light':
      body = cloud('url(#gl-cloud)') + drops(3, '#7dd3fc', 6);
      break;
    case 'light-moderate':
    case 'moderate':
      body = cloud('url(#gl-cloud)') + drops(4, '#38bdf8', 9);
      break;
    default:
      body = cloud('url(#gl-storm)') + drops(5, '#60a5fa', 11) + `<path class="g-bolt" d="M42 52 34 66h7l-4 11 12-16h-7l4-9Z" fill="#fde047"/>`;
  }
  el.innerHTML = `<svg viewBox="0 0 76 80">${defs}${body}</svg>`;
}
