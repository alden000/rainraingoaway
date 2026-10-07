/** Place search: instant offline matches from the gazetteer, then OneMap. */
import { haptic } from '../lib/haptics';
import { PLACES } from '../lib/places';
import { escapeHtml } from './dom';
import { icons } from './icons';
import { closeModal, openModal } from './modal';

export interface SearchHit {
  name: string;
  sub: string;
  lat: number;
  lon: number;
}

const titleCase = (s: string) => s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\bMrt\b/g, 'MRT').replace(/\bLrt\b/g, 'LRT');

async function onemap(q: string, signal: AbortSignal): Promise<SearchHit[]> {
  const url = `https://www.onemap.gov.sg/api/common/elastic/search?searchVal=${encodeURIComponent(q)}&returnGeom=Y&getAddrDetails=Y&pageNum=1`;
  const res = await fetch(url, { signal });
  if (!res.ok) return [];
  const json = (await res.json()) as { results?: Array<Record<string, string>> };
  const seen = new Set<string>();
  return (json.results ?? [])
    .map((r) => ({
      name: titleCase(r.SEARCHVAL || r.BUILDING || r.ADDRESS),
      sub: titleCase(r.ADDRESS ?? '').replace(/Singapore (\d{6})$/i, 'Singapore $1'),
      lat: parseFloat(r.LATITUDE),
      lon: parseFloat(r.LONGITUDE)
    }))
    .filter((h) => Number.isFinite(h.lat) && !seen.has(h.name) && seen.add(h.name))
    .slice(0, 8);
}

function local(q: string): SearchHit[] {
  const s = q.trim().toLowerCase();
  if (!s) return [];
  return PLACES.filter(([n]) => n.toLowerCase().includes(s))
    .slice(0, 4)
    .map(([name, lat, lon]) => ({ name, sub: 'Neighbourhood', lat, lon }));
}

function highlight(text: string, q: string) {
  const e = escapeHtml(text);
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (!q || i < 0) return e;
  return escapeHtml(text.slice(0, i)) + '<mark>' + escapeHtml(text.slice(i, i + q.length)) + '</mark>' + escapeHtml(text.slice(i + q.length));
}

export class SearchUI {
  private input: HTMLInputElement;
  private list: HTMLElement;
  private ctrl: AbortController | null = null;
  private timer = 0;
  private hits: SearchHit[] = [];
  private active = 0;

  constructor(private modal: HTMLElement, private onPick: (h: SearchHit) => void, private extras: () => SearchHit[]) {
    this.input = modal.querySelector('#search-input')!;
    this.list = modal.querySelector('#search-results')!;
    this.input.addEventListener('input', () => this.query());
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        this.active = (this.active + (e.key === 'ArrowDown' ? 1 : -1) + this.hits.length) % Math.max(1, this.hits.length);
        haptic('selection');
        this.paint();
      } else if (e.key === 'Enter' && this.hits[this.active]) {
        this.choose(this.hits[this.active]);
      }
    });
  }

  open() {
    openModal(this.modal);
    this.input.value = '';
    this.show(this.extras(), '');
    // Focus synchronously so mobile keyboards open within the user gesture.
    this.input.focus({ preventScroll: true });
  }

  private query() {
    clearTimeout(this.timer);
    const q = this.input.value.trim();
    if (!q) return this.show(this.extras(), '');
    const instant = local(q);
    this.show(instant, q, true);
    this.timer = window.setTimeout(async () => {
      this.ctrl?.abort();
      this.ctrl = new AbortController();
      try {
        const remote = await onemap(q, this.ctrl.signal);
        const names = new Set(instant.map((h) => h.name.toLowerCase()));
        this.show([...instant, ...remote.filter((r) => !names.has(r.name.toLowerCase()))], q);
      } catch (e) {
        if ((e as Error).name !== 'AbortError') this.show(instant, q);
      }
    }, 220);
  }

  private show(hits: SearchHit[], q: string, loading = false) {
    this.hits = hits;
    this.active = 0;
    this.paint(q, loading);
  }

  private paint(q = this.input.value.trim(), loading = false) {
    if (!this.hits.length) {
      this.list.innerHTML = `<li class="search-empty">${loading ? 'Searching…' : q ? 'No places found' : 'Type to search, or tap the map to check any spot'}</li>`;
      return;
    }
    this.list.innerHTML = this.hits
      .map(
        (h, i) => `<li style="animation-delay:${i * 30}ms"><button class="result ${i === this.active ? 'is-active' : ''}" data-i="${i}" data-haptic="selection">
          <span class="result__icon">${h.sub === 'Saved' ? icons.starFill : h.sub === 'Current location' ? icons.navigation : icons.pin}</span>
          <span><div class="result__name">${highlight(h.name, q)}</div><div class="result__sub">${escapeHtml(h.sub)}</div></span>
        </button></li>`
      )
      .join('');
    this.list.querySelectorAll<HTMLButtonElement>('.result').forEach((b) =>
      b.addEventListener('click', () => this.choose(this.hits[Number(b.dataset.i)]))
    );
  }

  private choose(h: SearchHit) {
    haptic('success');
    this.input.blur();
    closeModal(this.modal);
    this.onPick(h);
  }
}
