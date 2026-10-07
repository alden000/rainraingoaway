// Renders the app icons (PNG) from an inline SVG composition using Playwright's Chromium.
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';

const logo = readFileSync(new URL('../public/icons/logo.svg', import.meta.url), 'utf8');
const html = (size, pad, radius) => `<!doctype html><html><body style="margin:0;background:transparent">
<div style="width:${size}px;height:${size}px;border-radius:${radius}px;overflow:hidden;position:relative;
  background:radial-gradient(120% 90% at 30% 15%, #1e2a52 0%, #0b1022 55%, #05070d 100%);display:grid;place-items:center">
  <div style="position:absolute;inset:0;background:radial-gradient(60% 50% at 50% 62%, rgba(129,140,248,.45), transparent 70%)"></div>
  <div style="position:absolute;inset:${size * 0.12}px;border-radius:50%;border:${Math.max(1, size / 220)}px solid rgba(165,180,252,.18)"></div>
  <div style="position:absolute;inset:${size * 0.26}px;border-radius:50%;border:${Math.max(1, size / 220)}px solid rgba(165,180,252,.12)"></div>
  <div style="width:${size - pad * 2}px;height:${size - pad * 2}px;position:relative;filter:drop-shadow(0 ${size / 28}px ${size / 14}px rgba(129,140,248,.65))">${logo.replace('<svg ', '<svg width="100%" height="100%" ')}</div>
</div></body></html>`;

const targets = [
  ['icon-192.png', 192, 30, 42],
  ['icon-512.png', 512, 80, 112],
  ['maskable-512.png', 512, 130, 0],
  ['apple-touch-icon.png', 180, 30, 0]
];

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const [name, size, pad, radius] of targets) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(html(size, pad, radius));
  await page.screenshot({ path: `public/icons/${name}`, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  console.log('wrote', name);
}
await browser.close();
