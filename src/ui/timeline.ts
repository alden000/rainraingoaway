/** Scrubbable radar timeline: two hours of history + one hour of forecast. */
import { haptic } from '../lib/haptics';
import { clock } from '../radar/insights';
import { icons } from './icons';
import { setText } from './dom';

export interface TimelineFrame {
  time: number;
  forecast: boolean;
  rain?: boolean;
}

export interface TimelineOptions {
  onScrub: (index: number) => void;
  onTogglePlay: () => void;
}

export class Timeline {
  private frames: TimelineFrame[] = [];
  private index = 0;
  private nowIndex = 0;
  private track: HTMLElement;
  private thumb: HTMLElement;
  private ticks: HTMLElement;
  private nowEl: HTMLElement;
  private timeEl: HTMLElement;
  private relEl: HTMLElement;
  private playBtn: HTMLButtonElement;
  private past: HTMLElement;

  constructor(root: HTMLElement, private opts: TimelineOptions) {
    this.track = root.querySelector('#tl-track')!;
    this.thumb = root.querySelector('#tl-thumb')!;
    this.ticks = root.querySelector('#tl-ticks')!;
    this.nowEl = root.querySelector('#tl-now')!;
    this.timeEl = root.querySelector('#tl-time')!;
    this.relEl = root.querySelector('#tl-rel')!;
    this.playBtn = root.querySelector('#tl-play')!;
    this.past = root.querySelector('.tl-past')!;
    this.playBtn.addEventListener('click', () => opts.onTogglePlay());
    this.bindDrag();
  }

  private span() {
    const t0 = this.frames[0]?.time ?? 0;
    const t1 = this.frames[this.frames.length - 1]?.time ?? 1;
    return { t0, t1: Math.max(t1, t0 + 1) };
  }

  private pct(time: number) {
    const { t0, t1 } = this.span();
    return ((time - t0) / (t1 - t0)) * 100;
  }

  setFrames(frames: TimelineFrame[], nowIndex: number) {
    this.frames = frames;
    this.nowIndex = nowIndex;
    this.track.setAttribute('aria-valuemax', String(Math.max(0, frames.length - 1)));
    const now = frames[nowIndex];
    const nowPct = now ? this.pct(now.time) : 100;
    this.nowEl.style.left = `${nowPct}%`;
    this.past.style.width = `${nowPct}%`;
    let html = '';
    for (const f of frames) {
      const p = this.pct(f.time);
      const d = new Date(f.time + 8 * 3600_000);
      const hour = d.getUTCMinutes() === 0;
      html += `<i class="${hour ? 'hour' : ''}${f.rain ? ' rain' : ''}" style="left:${p}%"></i>`;
      if (hour) html += `<b style="left:${p}%">${String(d.getUTCHours()).padStart(2, '0')}:00</b>`;
    }
    this.ticks.innerHTML = html;
    this.setIndex(Math.min(this.index, frames.length - 1), false);
  }

  setIndex(i: number, notify = true) {
    if (!this.frames.length) return;
    i = Math.max(0, Math.min(this.frames.length - 1, i));
    const changed = i !== this.index;
    this.index = i;
    const f = this.frames[i];
    this.thumb.style.left = `${this.pct(f.time)}%`;
    this.track.setAttribute('aria-valuenow', String(i));
    setText(this.timeEl, clock(f.time));
    const mins = Math.round((f.time - this.frames[this.nowIndex].time) / 60_000);
    const rel = i === this.nowIndex ? 'Latest scan' : f.forecast ? `Forecast +${mins} min` : `${-mins} min ago`;
    setText(this.relEl, rel);
    this.track.setAttribute('aria-valuetext', `${clock(f.time)}, ${rel}`);
    this.relEl.classList.toggle('is-forecast', f.forecast);
    this.relEl.classList.toggle('is-now', i === this.nowIndex);
    if (changed && notify) this.opts.onScrub(i);
  }

  get current() {
    return this.index;
  }

  setPlaying(on: boolean) {
    this.playBtn.innerHTML = on ? icons.pause : icons.play;
    this.playBtn.classList.toggle('is-playing', on);
    this.playBtn.setAttribute('aria-label', on ? 'Pause radar loop' : 'Play radar loop');
    this.track.classList.toggle('is-playing', on);
  }

  private indexAt(clientX: number) {
    const r = this.track.getBoundingClientRect();
    const { t0, t1 } = this.span();
    const t = t0 + ((clientX - r.left) / r.width) * (t1 - t0);
    let best = 0;
    let bestD = Infinity;
    this.frames.forEach((f, i) => {
      const d = Math.abs(f.time - t);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  }

  private bindDrag() {
    let active = false;
    const update = (e: PointerEvent) => {
      const i = this.indexAt(e.clientX);
      if (i !== this.index) {
        haptic(i === this.nowIndex ? 'medium' : 'selection');
        this.setIndex(i);
      }
    };
    this.track.addEventListener('pointerdown', (e) => {
      active = true;
      this.track.setPointerCapture(e.pointerId);
      this.track.classList.add('is-dragging');
      update(e);
    });
    this.track.addEventListener('pointermove', (e) => active && update(e));
    const end = () => {
      active = false;
      this.track.classList.remove('is-dragging');
    };
    this.track.addEventListener('pointerup', end);
    this.track.addEventListener('pointercancel', end);
    this.track.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        e.stopPropagation();
        haptic('selection');
        this.setIndex(this.index + (e.key === 'ArrowRight' ? 1 : -1));
      } else if (e.key === 'Home' || e.key === 'End') {
        e.preventDefault();
        this.setIndex(e.key === 'Home' ? 0 : this.frames.length - 1);
      }
    });
  }
}
