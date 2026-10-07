/** Hand-tuned 24px line icons (1.6 stroke) — one consistent family. */
const s = (body: string, extra = '') =>
  `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${body}</svg>`;

export const icons = {
  search: s('<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>'),
  layers: s('<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5"/><path d="m3 17.5 9 5 9-5" opacity=".5"/>'),
  locate: s('<circle cx="12" cy="12" r="3.2"/><circle cx="12" cy="12" r="7.5"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22"/>'),
  plus: s('<path d="M12 5v14M5 12h14"/>'),
  minus: s('<path d="M5 12h14"/>'),
  play: s('<path d="M8 5.5v13a.6.6 0 0 0 .9.5l10.2-6.5a.6.6 0 0 0 0-1L8.9 5a.6.6 0 0 0-.9.5Z" fill="currentColor" stroke="none"/>'),
  pause: s('<rect x="6.5" y="5" width="3.6" height="14" rx="1.2" fill="currentColor" stroke="none"/><rect x="13.9" y="5" width="3.6" height="14" rx="1.2" fill="currentColor" stroke="none"/>'),
  close: s('<path d="M6 6l12 12M18 6 6 18"/>'),
  star: s('<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9L12 3.5Z"/>'),
  starFill: s('<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9L12 3.5Z" fill="currentColor"/>'),
  pin: s('<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z"/><circle cx="12" cy="10" r="2.4"/>'),
  navigation: s('<path d="M4 11.5 20 4l-7.5 16-2-6.5L4 11.5Z"/>'),
  clock: s('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
  wind: s('<path d="M3 8h10.5a2.5 2.5 0 1 0-2.5-2.5"/><path d="M3 12h15.5a2.5 2.5 0 1 1-2.5 2.5"/><path d="M3 16h7"/>'),
  info: s('<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.6v.1"/>'),
  download: s('<path d="M12 4v11M7 10.5l5 5 5-5"/><path d="M5 20h14"/>'),
  trash: s('<path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/>'),
  chevron: s('<path d="m9 6 6 6-6 6"/>'),
  radar: s('<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5" opacity=".6"/><path d="M12 12 18 6"/>'),
  umbrella: s('<path d="M3 12a9 9 0 0 1 18 0H3Z"/><path d="M12 12v6.5a2 2 0 0 1-4 0"/>'),
  drop: s('<path d="M12 3.5s6 6.4 6 10.5a6 6 0 0 1-12 0c0-4.1 6-10.5 6-10.5Z"/>'),
  sparkle: s('<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>'),
  grid: s('<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 9.3h16M4 14.6h16M9.3 4v16M14.6 4v16"/>'),
  vibrate: s('<rect x="8" y="4" width="8" height="16" rx="2"/><path d="M4 9v6M20 9v6"/>'),
  sound: s('<path d="M5 9.5h3l4-3.5v12l-4-3.5H5z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>')
};

export const logoSVG = `
<svg viewBox="0 0 64 64" width="64" height="64" aria-hidden="true">
  <defs>
    <linearGradient id="lg-drop" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#7dd3fc"/><stop offset=".55" stop-color="#818cf8"/><stop offset="1" stop-color="#e879f9"/>
    </linearGradient>
  </defs>
  <path d="M32 6c0 0 17 18.5 17 31a17 17 0 0 1-34 0C15 24.5 32 6 32 6Z" fill="url(#lg-drop)"/>
  <path d="M22.5 39a9.5 9.5 0 0 0 9.5 9.5" fill="none" stroke="#fff" stroke-opacity=".9" stroke-width="3" stroke-linecap="round"/>
  <path d="M27 39a5 5 0 0 0 5 5" fill="none" stroke="#fff" stroke-opacity=".6" stroke-width="3" stroke-linecap="round"/>
  <circle cx="32" cy="39" r="2.2" fill="#fff"/>
</svg>`;
