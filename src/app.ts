/**
 * Application controller: owns state, talks to the radar API and the
 * analysis worker, and keeps the map and every panel in sync.
 */
import {
  COVERAGE_BBOX, DEFAULT_CELL_M, FRAME_MS, HISTORY_FRAMES, RADAR_BBOX, RANGES, SINGAPORE_CENTER, type RadarRange
} from './config';
import { compassName, compassPoint, inBBox, distanceKm, type LatLon } from './lib/geo';
import { configureHaptics, haptic, installPressFeedback } from './lib/haptics';
import { nearestPlace } from './lib/places';
import { persisted } from './lib/store';
import { cellAt } from './lib/svy21';
import { buildGrid } from './map/grid';
import { RadarMap } from './map/radarMap';
import { RadarRenderer, type DisplayFrame } from './map/radarRenderer';
import type { BasemapId } from './map/style';
import { WindLayer } from './map/windLayer';
import { cachedFrames, listLatest, listRecent, loadFrame, loadFrames, pruneCache, type ScanRef } from './radar/api';
import type { WorkerRequest, WorkerResponse } from './radar/analysis.worker';
import { geoToPixel, sampleRate } from './radar/frameMath';
import { groundWindAt, refreshGroundWind } from './radar/groundWind';
import {
  clock, confidenceLabel, deriveInsights, duration, windDescriptor, windSentence
} from './radar/insights';
import { CLASS_LABEL, LEVEL_COUNT, RAIN_THRESHOLD, cssColor, rateClass, rateToLevel, type PaletteId } from './radar/palette';
import type { AnalysisSummary, MotionField, PointForecast, RadarFrame } from './radar/types';
import { OutlookChart } from './ui/chart';
import { $, escapeHtml, hydrateIcons, setText, swapText, tweenNumber } from './ui/dom';
import { HeroFx } from './ui/heroFx';
import { icons } from './ui/icons';
import { anyModalOpen, closeModal, closeTopModal, openModal } from './ui/modal';
import { SearchUI, type SearchHit } from './ui/search';
import { BottomSheet } from './ui/sheet';
import { Timeline } from './ui/timeline';
import { toast } from './ui/toast';
import { renderCompass, renderGlyph, renderRing, renderScope, setCompass } from './ui/widgets';

type BasemapSetting = 'auto' | BasemapId;

interface Settings {
  basemap: BasemapSetting;
  palette: PaletteId;
  opacity: number;
  wind: boolean;
  grid: boolean;
  forecastPlayback: boolean;
  haptics: boolean;
  sound: boolean;
  cellSize: number;
}

interface TimelineEntry {
  time: number;
  forecast: boolean;
  layers: Partial<Record<RadarRange, DisplayFrame>>;
}

interface SavedPlace {
  id: string;
  name: string;
  lat: number;
  lon: number;
}

interface Spot extends LatLon {
  kind: 'gps' | 'pick';
  name: string;
}

const SETTINGS = persisted<Settings>('rainrain.settings', {
  basemap: 'auto', palette: 'signature', opacity: 85, wind: true, grid: true, forecastPlayback: true,
  haptics: true, sound: false, cellSize: DEFAULT_CELL_M
});
/** Cell sizes offered in settings; anything else (e.g. the old 5 m default) moves to the new default. */
const CELL_SIZES = [25, 50, 100, 250];
function migrateSettings(s: Settings): Settings {
  return CELL_SIZES.includes(s.cellSize) ? s : { ...s, cellSize: DEFAULT_CELL_M };
}

const SAVED = persisted<{ places: SavedPlace[] }>('rainrain.saved', { places: [] });
/**
 * NEA publishes a scan every 5 minutes, ~10–30 s after the scan's timestamp.
 * We sleep until the next one is due, then retry briefly if it's late — about
 * one request per scan instead of one a minute.
 */
const NEXT_SCAN_DUE_MS = FRAME_MS + 20_000;
const RETRY_MS = 30_000;
/** Newest scan older than this shows as "Delayed". */
const STALE_AFTER_MS = 20 * 60_000;
/** Scans per range loaded before the first analysis (8 enables clutter filtering). */
const FIRST_PASS_FRAMES = 8;
const MAX_WAIT_MS = 5 * 60_000;
const STEP_MS = 420;

export class App {
  private settings = migrateSettings(SETTINGS.load());
  private saved = SAVED.load().places;
  private spot: Spot | null = null;
  private gps: (LatLon & { acc: number }) | null = null;
  private gpsWatch = -1;
  /** True while the spot is a placeholder awaiting the first GPS fix. */
  private provisionalSpot = false;

  private frames70: RadarFrame[] = [];
  /** Timeline entries; each carries the matching scan (or forecast) for every range. */
  private display: TimelineEntry[] = [];
  private nowIndex = 0;
  private clutter: Partial<Record<RadarRange, Uint8Array | null>> = {};
  private summary: AnalysisSummary | null = null;
  private pf: PointForecast | null = null;
  private savedPf = new Map<string, PointForecast>();
  private status: 'loading' | 'live' | 'stale' | 'offline' | 'error' = 'loading';

  private worker = new Worker(new URL('./radar/analysis.worker.ts', import.meta.url), { type: 'module' });
  private reqId = 0;
  private pending = new Map<number, (r: WorkerResponse) => void>();

  private renderers = Object.fromEntries(RANGES.map((r) => [r, new RadarRenderer(r, 480)])) as Record<RadarRange, RadarRenderer>;
  private map!: RadarMap;
  private wind!: WindLayer;
  private timeline!: Timeline;
  private chart!: OutlookChart;
  private sheet!: BottomSheet;
  private heroFx!: HeroFx;
  private search!: SearchUI;

  private playing = false;
  private playRaf = 0;
  private refreshing: Promise<void> | null = null;
  private pollTimer = 0;
  private backfillGen = 0;
  private gridTimer = 0;
  private pointsSeq = 0;
  private installEvt: (Event & { prompt(): Promise<void> }) | null = null;

  /* ====================================================================== */
  async start(): Promise<void> {
    hydrateIcons();
    installPressFeedback();
    configureHaptics(this.settings);
    this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const cb = this.pending.get(e.data.id);
      this.pending.delete(e.data.id);
      cb?.(e.data);
    };

    this.applyTheme();
    this.initMap();
    this.initUI();
    // Placeholder spot so the panel is useful while the location prompt is pending.
    this.provisionalSpot = true;
    this.setSpot({ ...SINGAPORE_CENTER, kind: 'pick', name: 'Singapore' });
    this.splash(0.15, 'Contacting the NEA radar…');

    // Instant start from cache, then go to the network.
    const cached = await Promise.all(
      RANGES.map((r) => cachedFrames(r, HISTORY_FRAMES * FRAME_MS + 10 * 60_000).catch(() => []))
    );
    if (cached[0].length) await this.ingest(Object.fromEntries(RANGES.map((r, i) => [r, cached[i]])));

    this.locate(false);
    await Promise.race([this.refresh(), new Promise((r) => setTimeout(r, 12_000))]);
    await Promise.race([this.map.ready, new Promise((r) => setTimeout(r, 4000))]);
    this.splash(1, 'Ready');
    setTimeout(() => this.finishSplash(), 380);

    this.schedulePoll();
    setInterval(() => this.updateFreshness(), 20_000);
    document.addEventListener('visibilitychange', () => !document.hidden && this.poll());
    window.addEventListener('online', () => this.poll());
    window.addEventListener('offline', () => this.setStatus('offline'));
    void pruneCache(3 * 3600_000);
  }

  private splash(progress: number, text: string) {
    const bar = document.getElementById('splash-bar');
    if (bar) bar.style.width = `${Math.round(progress * 100)}%`;
    const t = document.getElementById('splash-step');
    if (t) t.textContent = text;
  }

  private finishSplash() {
    const s = document.getElementById('splash');
    if (!s) return;
    s.classList.add('is-done');
    $('#app').classList.remove('is-booting');
    haptic('success');
    setTimeout(() => s.remove(), 1200);
  }

  /* ---- Worker RPC ------------------------------------------------------ */
  private call(msg: WorkerRequest): Promise<WorkerResponse> {
    return new Promise((resolve) => {
      this.pending.set(msg.id, resolve);
      this.worker.postMessage(msg);
    });
  }

  /* ---- Data ------------------------------------------------------------ */
  /** Frames currently held per range, oldest first. */
  private held: Partial<Record<RadarRange, RadarFrame[]>> = {};

  /**
   * Routine update: fetch just the newest scan of each range and append it,
   * instead of re-listing two hours of history.
   */
  private async update(latest70: ScanRef): Promise<void> {
    if (this.refreshing) return this.refreshing;
    let needFull = false;
    this.refreshing = (async () => {
      try {
        const refs = await Promise.all(RANGES.map((r) => (r === '70km' ? latest70 : listLatest(r).catch(() => null))));
        const next: Partial<Record<RadarRange, RadarFrame[]>> = {};
        await Promise.all(
          RANGES.map(async (r, i) => {
            const have = this.held[r] ?? [];
            const ref = refs[i];
            const fresh = ref && !have.some((f) => f.time === ref.time) ? await loadFrame(ref).catch(() => null) : null;
            const merged = fresh ? [...have, fresh].sort((a, b) => a.time - b.time) : have;
            next[r] = merged.slice(-HISTORY_FRAMES);
          })
        );
        // A gap (e.g. the phone slept) means the history is stale: re-list it fully.
        const f70 = next['70km'] ?? [];
        needFull = f70.length >= 2 && f70[f70.length - 1].time - f70[f70.length - 2].time > 2 * FRAME_MS;
        if (!needFull) {
          await this.ingest(next);
          this.markFresh();
        }
      } catch (err) {
        console.warn('Radar update failed', err);
        // A transient failure doesn't make held data old: judge by its age.
        if (navigator.onLine) this.markFresh();
        else this.setStatus('offline');
      } finally {
        this.refreshing = null;
      }
    })();
    await this.refreshing;
    if (needFull) await this.refresh();
  }

  private async refresh(): Promise<void> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      try {
        if (this.status === 'loading') this.splash(0.3, 'Downloading the latest scans…');
        const refs = await Promise.all(
          RANGES.map((r, i) => listRecent(r, HISTORY_FRAMES).catch((e) => (i === 0 ? Promise.reject(e) : [])))
        );
        if (!refs[0].length) throw new Error('No radar scans available');
        // Fast first paint: the newest scans (enough for tracking and clutter
        // filtering) go to analysis right away; the rest of the 2-hour history
        // streams in afterwards and is merged in.
        const first = await Promise.all(refs.map((r) => loadFrames(r.slice(0, FIRST_PASS_FRAMES), 4)));
        if (this.status === 'loading') this.splash(0.7, 'Tracking rain echoes…');
        await this.ingest(this.mergeHeld(first));
        this.markFresh();
        if (refs.some((r) => r.length > FIRST_PASS_FRAMES)) void this.backfill(refs);
      } catch (err) {
        console.warn('Radar refresh failed', err);
        const offline = !navigator.onLine;
        if (offline) this.setStatus('offline');
        else if (this.frames70.length) this.markFresh();
        else this.setStatus('error');
        if (!this.frames70.length) {
          setText($('#now-rate'), offline ? 'You are offline — radar unavailable' : 'Radar temporarily unavailable');
          toast(offline ? 'Offline — will refresh when you reconnect' : 'Could not reach the NEA radar. Retrying shortly.', { icon: 'radar' });
        }
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }

  /** Time the next check for when NEA's next scan should be out. */
  private schedulePoll() {
    clearTimeout(this.pollTimer);
    const latest = this.frames70[this.frames70.length - 1]?.time ?? 0;
    const due = latest + NEXT_SCAN_DUE_MS - Date.now();
    const wait = due > 0 ? Math.min(due, MAX_WAIT_MS) : RETRY_MS;
    this.pollTimer = window.setTimeout(() => void this.poll(), wait);
  }

  /** Union of what we hold with newly loaded scans, per range, newest HISTORY_FRAMES kept. */
  private mergeHeld(loaded: RadarFrame[][]): Partial<Record<RadarRange, RadarFrame[]>> {
    return Object.fromEntries(
      RANGES.map((r, i) => {
        const byTime = new Map<number, RadarFrame>();
        for (const f of this.held[r] ?? []) byTime.set(f.time, f);
        for (const f of loaded[i] ?? []) byTime.set(f.time, f);
        const newest = loaded[i]?.length ? Math.max(...loaded[i].map((f) => f.time)) : Infinity;
        const all = [...byTime.values()].filter((f) => f.time > newest - HISTORY_FRAMES * FRAME_MS).sort((a, b) => a.time - b.time);
        return [r, all.slice(-HISTORY_FRAMES)];
      })
    );
  }

  /** Load the remaining history in the background and merge it in. */
  private async backfill(refs: ScanRef[][]) {
    const gen = ++this.backfillGen;
    const rest = await Promise.all(refs.map((r) => loadFrames(r.slice(FIRST_PASS_FRAMES), 3).catch(() => [])));
    if (gen !== this.backfillGen) return;
    // Wait out any update in flight so we merge onto the newest state.
    if (this.refreshing) await this.refreshing.catch(() => undefined);
    await this.ingest(this.mergeHeld(rest));
  }

  private async poll() {
    // Paused while hidden; visibilitychange triggers a fresh poll on return.
    if (document.hidden) return;
    if (this.refreshing) return void this.refreshing.finally(() => this.schedulePoll());
    try {
      const latest = await listLatest('70km');
      const have = this.frames70[this.frames70.length - 1]?.time ?? 0;
      if (latest && latest.time > have) {
        // Small step forward → incremental update; otherwise reload the history.
        if (have && latest.time - have <= 2 * FRAME_MS) await this.update(latest);
        else await this.refresh();
        if (latest.time > have && have) haptic('selection');
      } else this.markFresh(); // already have the newest scan
    } catch {
      if (!navigator.onLine) this.setStatus('offline');
    }
    this.schedulePoll();
  }

  private async ingest(frames: Partial<Record<RadarRange, RadarFrame[]>>) {
    const f70 = frames['70km'] ?? [];
    if (!f70.length) return;
    this.held = frames;
    const latestOld = this.frames70[this.frames70.length - 1]?.time;
    this.frames70 = f70;
    const id = ++this.reqId;
    const res = await this.call({ type: 'analyze', id, frames });
    if (res.type !== 'analysis') {
      console.warn('Analysis failed', res);
      return;
    }
    if (id !== this.reqId) return;
    this.summary = res.summary;
    this.clutter = res.clutter;

    const wasAtNow = this.timeline.current === this.nowIndex || latestOld === undefined;
    const viewedTime = this.display[this.timeline.current]?.time;
    // Index every range's scans and forecasts by time, then align them to the 70 km timeline.
    const byTime = Object.fromEntries(
      RANGES.map((r) => {
        const m = new Map<number, DisplayFrame>();
        for (const f of frames[r] ?? []) m.set(f.time, { time: f.time, levels: f.levels, width: f.width, height: f.height, forecast: false });
        for (const f of res.forecast[r] ?? []) m.set(f.time, { time: f.time, levels: f.levels, width: 480, height: 480, forecast: true });
        return [r, m];
      })
    ) as Record<RadarRange, Map<number, DisplayFrame>>;
    const pick = (r: RadarRange, t: number) => {
      const exact = byTime[r].get(t);
      if (exact) return exact;
      // A missing scan: fall back to the closest earlier one within 10 minutes.
      let best: DisplayFrame | undefined;
      for (const f of byTime[r].values()) if (f.time <= t && t - f.time <= 10 * 60_000 && (!best || f.time > best.time)) best = f;
      return best;
    };
    const times = [...f70.map((f) => f.time), ...(res.forecast['70km'] ?? []).map((f) => f.time)];
    this.display = times.map((t, i) => ({
      time: t,
      forecast: i >= f70.length,
      layers: Object.fromEntries(RANGES.map((r) => [r, pick(r, t)]).filter(([, f]) => f))
    }));
    this.nowIndex = f70.length - 1;
    for (const r of RANGES) this.renderers[r].retain(this.display.map((d) => d.layers[r]).filter((f): f is DisplayFrame => !!f));
    this.timeline.setFrames(this.display.map((d) => ({ time: d.time, forecast: d.forecast })), this.nowIndex);
    if (wasAtNow) this.timeline.setIndex(this.nowIndex, false);
    else {
      // Keep looking at the same moment even if older history was prepended.
      const same = this.display.findIndex((d) => d.time === viewedTime);
      this.timeline.setIndex(same >= 0 ? same : this.nowIndex, false);
    }
    this.showFrame(this.timeline.current);

    this.wind.setFields(this.flowFields());
    void refreshGroundWind().then(() => this.renderGroundWind());
    this.renderWind();
    this.updateFreshness();
    await this.requestPoints();
  }

  /** Trackable motion fields, finest range first. */
  private flowFields(): MotionField[] {
    const m = this.summary?.motion ?? {};
    return RANGES.map((r) => m[r]).filter((f): f is MotionField => !!f && f.confidence > 0);
  }

  private async requestPoints() {
    if (!this.summary || !this.spot) return;
    const seq = ++this.pointsSeq;
    const points = [
      { key: '__spot', lat: this.spot.lat, lon: this.spot.lon },
      ...this.saved.map((p) => ({ key: p.id, lat: p.lat, lon: p.lon }))
    ];
    const res = await this.call({ type: 'points', id: ++this.reqId, points });
    if (res.type !== 'points' || seq !== this.pointsSeq) return;
    for (const r of res.results) {
      if (r.key === '__spot') this.pf = r.forecast;
      else this.savedPf.set(r.key, r.forecast);
    }
    this.renderSpot();
    this.renderPlaces();
    this.markTimelineRain();
  }

  /* ---- Status ------------------------------------------------------------ */
  /** Live while the newest scan is recent; "Delayed" only when the data really is old. */
  private markFresh() {
    const latest = this.frames70[this.frames70.length - 1]?.time ?? 0;
    this.setStatus(Date.now() - latest > STALE_AFTER_MS ? 'stale' : 'live');
  }

  private setStatus(s: App['status']) {
    this.status = s;
    this.updateFreshness();
  }

  private updateFreshness() {
    const live = $('#live');
    const latest = this.frames70[this.frames70.length - 1]?.time;
    let state = this.status;
    if (state === 'live' && latest && Date.now() - latest > STALE_AFTER_MS) state = 'stale';
    live.dataset.state = state;
    const text =
      state === 'loading' ? 'Connecting' : state === 'error' ? 'No data' : state === 'offline' ? 'Offline' : state === 'stale' ? `Delayed · ${latest ? clock(latest) : ''}` : `Live · ${latest ? clock(latest) : ''}`;
    setText($('#live-text'), text);
    if (this.summary && latest) {
      const ago = Math.round((Date.now() - latest) / 60_000);
      setText($('#issued'), `Radar ${clock(latest)} · ${ago <= 1 ? 'just now' : `${ago} min ago`}`);
    }
  }

  /* ---- Map --------------------------------------------------------------- */
  private resolvedBasemap(): BasemapId {
    const b = this.settings.basemap;
    if (b !== 'auto') return b;
    return matchMedia('(prefers-color-scheme: light)').matches ? 'daylight' : 'midnight';
  }

  private applyTheme() {
    const light = this.resolvedBasemap() === 'daylight';
    document.documentElement.dataset.theme = light ? 'light' : 'dark';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', light ? '#f3f0e8' : '#070b14');
    this.wind?.setTheme(!light);
    this.heroFx?.setTheme(!light);
  }

  private initMap() {
    for (const r of RANGES) this.renderers[r].setPalette(this.settings.palette);
    this.map = new RadarMap({
      container: $('#map'),
      basemap: this.resolvedBasemap(),
      radarCanvases: Object.fromEntries(RANGES.map((r) => [r, this.renderers[r].canvas])) as Record<RadarRange, HTMLCanvasElement>,
      onPick: (p) => this.pick(p),
      onMove: () => this.scheduleGrid()
    });
    this.map.setPalette(this.settings.palette);
    this.map.setRadarOpacity(this.settings.opacity / 100);
    this.map.setGridVisible(this.settings.grid);
    this.map.fitSingapore(false);
    this.wind = new WindLayer(this.map.map, $('#app'));
    this.wind.setTheme(this.resolvedBasemap() !== 'daylight');
    this.wind.setVisible(this.settings.wind);
    this.map.map.on('style.load', () => {
      this.map.setRadarOpacity(this.settings.opacity / 100);
      this.map.setGridVisible(this.settings.grid);
      if (this.spot) this.map.setSpot(this.spot, this.settings.cellSize, this.spot.kind);
      if (this.gps) this.map.setUserLocation(this.gps, this.gps.acc);
      this.scheduleGrid();
    });
    matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
      if (this.settings.basemap === 'auto') this.applyBasemap();
    });
  }

  private applyBasemap() {
    this.applyTheme();
    this.map.setBasemap(this.resolvedBasemap());
  }

  private showFrame(i: number, next: number | null = null, t = 0) {
    const a = this.display[i];
    if (!a) return;
    const b = next !== null ? this.display[next] : null;
    // While playing, only redraw (and re-upload) the ranges actually on screen;
    // a still frame redraws everything so panning reveals the right image.
    const visible = this.playing ? this.map.visibleRanges() : null;
    if (visible) this.map.setAnimatedRanges(visible);
    for (const r of RANGES) {
      if (visible && !visible.has(r)) continue;
      this.renderers[r].draw(a.layers[r] ?? null, b?.layers[r] ?? null, t);
    }
    if (!this.playing) this.map.repaintRadar();
    $('#app').classList.toggle('is-forecast', a.forecast);
  }

  private scheduleGrid() {
    clearTimeout(this.gridTimer);
    this.gridTimer = window.setTimeout(() => this.updateGrid(), 60);
  }

  /** Rain rate at a point for a timeline entry, from the finest range covering it. */
  private frameSampler(entry: TimelineEntry | undefined) {
    return (lat: number, lon: number) => {
      if (!entry) return 0;
      for (const r of RANGES) {
        const frame = entry.layers[r];
        if (!frame) continue;
        const p = geoToPixel(RADAR_BBOX[r], frame.width, frame.height, lat, lon);
        if (p.x < 0 || p.y < 0 || p.x >= frame.width || p.y >= frame.height) continue;
        const mask = frame.forecast ? null : this.clutter[r] ?? null;
        return sampleRate(frame.levels, frame.width, frame.height, p.x, p.y, mask);
      }
      return 0;
    };
  }

  private updateGrid(onReady?: () => void) {
    const chip = $('#grid-chip');
    const zoom = this.map.zoom();
    if (!this.settings.grid || zoom < 12) {
      this.map.setGrid({ type: 'FeatureCollection', features: [] }, onReady);
      chip.classList.add('is-hidden');
      return;
    }
    const frame = this.display[this.timeline.current];
    const g = buildGrid(this.map.bounds(), this.settings.cellSize, this.frameSampler(frame));
    if (!g) {
      chip.classList.add('is-hidden');
      onReady?.();
      return;
    }
    this.map.setGrid(g.fc, onReady);
    chip.classList.remove('is-hidden');
    setText($('#grid-chip-text'), g.size === this.settings.cellSize ? `${g.size} m grid` : `${g.size} m grid · zoom in for ${this.settings.cellSize} m`);
  }

  /* ---- Spot & location ---------------------------------------------------- */
  private pick(p: LatLon, name?: string) {
    this.provisionalSpot = false;
    if (!inBBox(p, COVERAGE_BBOX)) {
      haptic('warning');
      toast('That spot is beyond the NEA radar’s 480 km coverage', { icon: 'info' });
      return;
    }
    haptic('medium');
    $('#app').classList.remove('is-picking');
    this.setSpot({ ...p, kind: 'pick', name: name ?? nearestPlace(p).name });
  }

  private setSpot(s: Spot) {
    const prev = this.spot;
    this.spot = s;
    this.map.setSpot(s, this.settings.cellSize, s.kind);
    this.renderSpotHeader();
    if (this.summary) this.renderGroundWind();
    const moved = !prev || distanceKm(prev, s) * 1000 >= this.settings.cellSize || prev.kind !== s.kind;
    if (moved) void this.requestPoints();
  }

  private locate(fly: boolean) {
    if (!('geolocation' in navigator)) {
      this.fallbackSpot('Location isn’t available on this device');
      return;
    }
    const btn = $('#btn-locate');
    btn.classList.add('is-busy');
    const onPos = (pos: GeolocationPosition) => {
      btn.classList.remove('is-busy');
      const p = { lat: pos.coords.latitude, lon: pos.coords.longitude, acc: pos.coords.accuracy };
      if (!inBBox(p, COVERAGE_BBOX)) {
        this.gps = null;
        this.map.setUserLocation(null);
        if (!this.spot || this.provisionalSpot) this.fallbackSpot('You’re outside radar coverage — showing Singapore');
        return;
      }
      const first = !this.gps;
      this.gps = p;
      btn.classList.add('is-active');
      this.map.setUserLocation(p, p.acc);
      if (!this.spot || this.spot.kind === 'gps' || this.provisionalSpot) {
        this.provisionalSpot = false;
        this.setSpot({ lat: p.lat, lon: p.lon, kind: 'gps', name: nearestPlace(p).name });
      }
      if (first || fly) {
        fly = false;
        if (this.spot?.kind === 'gps') this.map.flyTo(p, 15.5);
      }
    };
    const onErr = (err: GeolocationPositionError) => {
      btn.classList.remove('is-busy');
      if (!this.spot || this.provisionalSpot) this.fallbackSpot(err.code === err.PERMISSION_DENIED ? 'Location is off — tap the map to check any spot' : 'Couldn’t find you — tap the map to check any spot');
      else if (fly) toast('Couldn’t get your location', { icon: 'locate' });
    };
    if (this.gpsWatch < 0) {
      this.gpsWatch = navigator.geolocation.watchPosition(onPos, onErr, { enableHighAccuracy: true, maximumAge: 20_000, timeout: 20_000 });
    } else if (this.gps) {
      onPos({ coords: { latitude: this.gps.lat, longitude: this.gps.lon, accuracy: this.gps.acc } } as GeolocationPosition);
    } else {
      navigator.geolocation.getCurrentPosition(onPos, onErr, { enableHighAccuracy: true, timeout: 15_000 });
    }
  }

  private fallbackSpot(message: string) {
    toast(message, { icon: 'locate', duration: 5000 });
    this.provisionalSpot = false;
    const c = { lat: SINGAPORE_CENTER.lat, lon: SINGAPORE_CENTER.lon };
    this.setSpot({ ...c, kind: 'pick', name: nearestPlace(c).name });
  }

  /* ---- Rendering: hero & insights ----------------------------------------- */
  private renderSpotHeader() {
    const s = this.spot;
    if (!s) return;
    const kind = $('#spot-kind');
    kind.innerHTML = this.provisionalSpot
      ? `${icons.locate}Finding you… showing island centre`
      : s.kind === 'gps' ? `${icons.navigation}Your location` : `${icons.pin}Selected spot`;
    setText($('#spot-name'), s.name);
    setText($('#pk-place'), s.name);
    const cell = cellAt(s.lat, s.lon, this.settings.cellSize);
    setText($('#cell-id'), cell.id);
    setText($('#cell-size'), `${this.settings.cellSize} m cell`);
    $('#back-to-me').hidden = !(s.kind === 'pick' && this.gps);
    const saved = this.isSaved(s);
    const star = $('#save-spot');
    star.classList.toggle('is-on', !!saved);
    star.innerHTML = saved ? icons.starFill : icons.star;
    star.setAttribute('aria-label', saved ? 'Remove from saved places' : 'Save this place');
  }

  private isSaved(p: LatLon) {
    return this.saved.find((s) => distanceKm(s, p) < 0.03);
  }

  private renderSpot() {
    const pf = this.pf;
    if (!pf) return;
    const ins = deriveInsights(pf);
    const hero = $('#hero');
    hero.dataset.tone = ins.tone;
    const hour = new Date(Date.now() + 8 * 3600_000).getUTCHours();
    renderGlyph($('#glyph'), ins.cls, ins.tone === 'watch', hour < 7 || hour >= 19);
    swapText($('#now-title'), ins.title);
    setText($('#now-rate'), ins.raining ? `${ins.label} · ${ins.rateText}` : pf.clutter ? 'No rain (radar clutter filtered)' : 'No rain on your square');
    setText($('#headline'), ins.headline);

    // Phone summary strip.
    const peek = $('#peek');
    peek.dataset.tone = ins.tone;
    renderGlyph($('#pk-glyph'), ins.cls, ins.tone === 'watch', hour < 7 || hour >= 19);
    setText($('#pk-title'), ins.title);
    setText($('#pk-next'), ins.next.text);
    setText($('#pk-outlook'), ins.outlook.text);
    const near = Math.max(0, ...pf.steps.slice(1, 7).map((st) => st.prob));
    if (ins.raining) {
      setText($('#pk-stat'), pf.nowRate < 1 ? pf.nowRate.toFixed(1) : String(Math.round(pf.nowRate)));
      setText($('#pk-stat-label'), 'mm/h now');
    } else {
      setText($('#pk-stat'), `${Math.round(near * 100)}%`);
      setText($('#pk-stat-label'), 'rain ≤30 min');
    }
    this.heroFx.setRate(pf.nowRate);

    this.chart.update(pf.steps, pf.issued);

    // Insight cards.
    const toneColor = (k: string) => (k === 'start' || k === 'continue' ? 'var(--wet)' : k === 'chance' ? 'var(--watch)' : 'var(--calm)');
    const nextLabel = ins.next.minutes !== null ? `${Math.max(1, Math.round(ins.next.minutes))}′` : `${Math.round(ins.next.prob * 100)}%`;
    renderRing($('#next-ring'), ins.next.minutes !== null ? 1 - Math.min(30, ins.next.minutes) / 30 : ins.next.prob, toneColor(ins.next.kind), nextLabel);
    setText($('#next-title'), ins.next.text);
    setText($('#next-detail'), ins.next.detail);
    const farMax = Math.max(0, ...pf.steps.slice(7).map((s) => s.prob));
    const outLabel = ins.outlook.minutes !== null ? duration(ins.outlook.minutes).replace(' min', '′').replace(' h', 'h').replace(/ /g, '') : `${Math.round(farMax * 100)}%`;
    renderRing(
      $('#outlook-ring'),
      ins.outlook.minutes !== null ? 1 - Math.min(180, ins.outlook.minutes) / 180 : farMax,
      ins.outlook.kind === 'incoming' || ins.outlook.kind === 'persist' ? 'var(--wet)' : ins.outlook.kind === 'later' ? 'var(--watch)' : 'var(--calm)',
      outLabel.length > 5 ? outLabel.replace(/(\d+)h(\d+)′/, '$1h$2') : outLabel
    );
    setText($('#outlook-title'), ins.outlook.text);
    setText($('#outlook-detail'), ins.outlook.detail);

    // Nearby.
    const n = pf.nearest;
    const raining = pf.nowRate >= RAIN_THRESHOLD;
    renderScope(
      $('#scope'),
      raining ? { distanceKm: 0, bearingDeg: 0, color: cssColor(this.settings.palette, Math.max(1, rateToLevel(pf.nowRate)), 1) }
        : n ? { distanceKm: n.distanceKm, bearingDeg: n.bearingDeg, color: cssColor(this.settings.palette, Math.max(1, rateToLevel(n.rate)), 1) } : null
    );
    if (raining) {
      setText($('#nearest-title'), 'Rain right here');
      setText($('#nearest-detail'), `${CLASS_LABEL[rateClass(pf.nowRate)]} over your ${this.settings.cellSize} m square.`);
    } else if (n) {
      const d = n.distanceKm < 10 ? n.distanceKm.toFixed(1) : String(Math.round(n.distanceKm));
      setText($('#nearest-title'), `Nearest rain ${d} km ${compassPoint(n.bearingDeg)}`);
      setText($('#nearest-detail'), `${CLASS_LABEL[rateClass(n.rate)]} to the ${compassName(n.bearingDeg)}.`);
    } else {
      setText($('#nearest-title'), 'No rain on radar');
      setText($('#nearest-detail'), 'Clear for 240 km in every direction.');
    }
    const tr = pf.trend;
    setText($('#trend-text'), tr > 1.012 ? 'Showers across the region are growing.' : tr < 0.988 ? 'Showers across the region are weakening.' : 'Rain coverage across the region is steady.');
    if (this.summary) setText($('#coverage'), `${Math.round(this.summary.regionCoverage * 100)}% of Singapore wet`);

    this.renderWind();
  }

  private renderWind() {
    const s = this.summary;
    if (!s) return;
    const w = this.pf?.wind ?? s.wind;
    const known = w.source !== 'none' && w.confidence > 0;
    const speedEl = $('#wind-speed');
    if (known) tweenNumber(speedEl, Math.round(w.speedKmh));
    else {
      speedEl.textContent = '—';
      delete speedEl.dataset.value;
    }
    setCompass($('#compass'), known ? (w.fromDeg + 180) % 360 : null);
    setText($('#wind-dir'), known ? `From the ${compassPoint(w.fromDeg)} · ${Math.round(w.fromDeg)}° — ${windDescriptor(w.speedKmh)}` : 'Not enough echoes to track');
    setText($('#wind-sentence'), windSentence(w));
    setText($('#wind-conf'), `${confidenceLabel(w.confidence)} confidence`);
    const local = known && w.localSpeedKmh !== undefined && w.localFromDeg !== undefined
      ? `Over this spot: ${Math.round(w.localSpeedKmh)} km/h from the ${compassPoint(w.localFromDeg)} · tracked on the ${w.source} radar`
      : known ? `Tracked on the ${w.source} radar` : '';
    setText($('#wind-local'), local);
    this.renderGroundWind();
    setText($('#pk-wind-text'), known ? `${Math.round(w.speedKmh)} km/h ${compassPoint(w.fromDeg)}` : 'Calm');
    const arrow = $('#pk-arrow');
    arrow.style.transform = `rotate(${known ? (w.fromDeg + 180) % 360 : 0}deg)`;
    arrow.style.opacity = known ? '1' : '0.3';
  }

  /** NEA station wind nearest the spot, for comparison with the steering wind. */
  private renderGroundWind() {
    const el = $('#wind-ground');
    const g = this.spot ? groundWindAt(this.spot) : null;
    el.hidden = !g;
    if (!g) return;
    const calm = g.speedKmh < 1;
    const where = g.distanceKm < 1 ? g.station : `${g.station}, ${g.distanceKm < 10 ? g.distanceKm.toFixed(1) : Math.round(g.distanceKm)} km away`;
    setText(
      $('#wind-ground-text'),
      `Ground level: ${calm ? 'calm' : `${Math.round(g.speedKmh)} km/h from the ${compassPoint(g.fromDeg)}`} · NEA ${where}${g.time ? ` · ${clock(g.time)}` : ''}`
    );
    const arrow = $('#wind-ground-arrow');
    arrow.style.transform = `rotate(${(g.fromDeg + 180) % 360}deg)`;
    arrow.style.opacity = calm ? '0.3' : '1';
  }

  private renderPlaces() {
    const list = $('#places-list');
    setText($('#places-count'), this.saved.length ? `${this.saved.length}` : '');
    if (!this.saved.length) {
      list.innerHTML = `<li class="places__empty">Tap ☆ on any spot to keep an eye on it here — home, office, the hawker centre.</li>`;
      return;
    }
    list.innerHTML = this.saved
      .map((p, i) => {
        const pf = this.savedPf.get(p.id);
        const ins = pf ? deriveInsights(pf) : null;
        const c = ins ? (ins.tone === 'wet' ? 'var(--wet)' : ins.tone === 'watch' ? 'var(--watch)' : 'var(--calm)') : 'var(--ink-3)';
        return `<li style="animation-delay:${i * 40}ms"><div class="place" data-id="${p.id}" data-press role="button" tabindex="0">
          <span class="place__dot" style="--c:${c}">${ins?.raining ? icons.umbrella : icons.drop}</span>
          <span style="min-width:0"><div class="place__name">${escapeHtml(p.name)}</div><div class="place__sub">${ins ? escapeHtml(`${ins.title} · ${ins.headline}`) : 'Waiting for radar…'}</div></span>
          <span class="muted">${icons.chevron}</span>
          <button class="place__del" data-del="${p.id}" aria-label="Remove ${escapeHtml(p.name)}" data-haptic="warning">${icons.trash}</button>
        </div></li>`;
      })
      .join('');
    list.querySelectorAll<HTMLElement>('.place').forEach((el) => {
      el.addEventListener('click', (e) => {
        const del = (e.target as HTMLElement).closest<HTMLElement>('[data-del]');
        const place = this.saved.find((p) => p.id === el.dataset.id);
        if (!place) return;
        if (del) {
          e.stopPropagation();
          this.saved = this.saved.filter((p) => p.id !== place.id);
          SAVED.save({ places: this.saved });
          this.renderPlaces();
          this.renderSpotHeader();
          toast(`Removed ${place.name}`, { icon: 'trash' });
          return;
        }
        this.setSpot({ lat: place.lat, lon: place.lon, kind: 'pick', name: place.name });
        this.map.flyTo(place, 15);
        this.sheet.snap('peek');
      });
    });
  }

  private markTimelineRain() {
    if (!this.spot || !this.display.length) return;
    const frames = this.display.map((d) => ({
      time: d.time,
      forecast: d.forecast,
      rain: this.frameSampler(d)(this.spot!.lat, this.spot!.lon) >= RAIN_THRESHOLD
    }));
    this.timeline.setFrames(frames, this.nowIndex);
  }

  /* ---- Playback ----------------------------------------------------------- */
  private loopEnd() {
    return this.settings.forecastPlayback ? this.display.length - 1 : this.nowIndex;
  }

  private togglePlay() {
    if (this.playing) return this.stopPlay();
    if (this.display.length < 2) return;
    this.playing = true;
    this.timeline.setPlaying(true);
    this.map.setRadarAnimating(true);
    this.map.setGridFillPaused(true);
    const start = Math.max(0, this.nowIndex - 12);
    if (this.timeline.current >= this.loopEnd() || this.timeline.current < start) this.timeline.setIndex(start);
    let t0 = performance.now();
    let hold = 0;
    const step = (now: number) => {
      if (!this.playing) return;
      const i = this.timeline.current;
      const end = this.loopEnd();
      if (i >= end) {
        if (!hold) hold = now;
        if (now - hold > 1400) {
          hold = 0;
          this.timeline.setIndex(start);
          t0 = now;
        }
      } else {
        const t = Math.min(1, (now - t0) / STEP_MS);
        const eased = t * t * (3 - 2 * t);
        this.showFrame(i, i + 1, eased);
        if (t >= 1) {
          this.timeline.setIndex(i + 1);
          t0 = now;
        }
      }
      this.playRaf = requestAnimationFrame(step);
    };
    this.playRaf = requestAnimationFrame(step);
  }

  private stopPlay() {
    if (!this.playing) return;
    this.playing = false;
    cancelAnimationFrame(this.playRaf);
    this.timeline.setPlaying(false);
    this.map.setRadarAnimating(false);
    this.showFrame(this.timeline.current);
    // Rebuild the rain cells for the paused frame, and reveal them only once
    // they're ready so a stale frame never flashes up.
    clearTimeout(this.gridTimer);
    this.updateGrid(() => this.map.setGridFillPaused(false));
  }

  /* ---- UI wiring ---------------------------------------------------------- */
  private initUI() {
    this.sheet = new BottomSheet($('#panel'), $('#panel-scroll'), $('#sheet-grabber'), $('#peek'));
    const peek = $('#peek');
    const togglePeek = () => this.sheet.snap(this.sheet.current === 'peek' ? 'half' : 'peek');
    peek.addEventListener('click', togglePeek);
    peek.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), togglePeek()));
    setText($('#build-tag'), `Build ${__BUILD__}`);
    this.timeline = new Timeline($('#timeline'), {
      onScrub: (i) => {
        if (!this.playing) {
          this.showFrame(i);
          this.scheduleGrid();
        } else if (document.activeElement === $('#tl-track')) this.stopPlay();
      },
      onTogglePlay: () => this.togglePlay()
    });
    $('#tl-track').addEventListener('pointerdown', () => this.stopPlay());
    this.chart = new OutlookChart($('#chart'));
    this.chart.setPalette(this.settings.palette);
    this.heroFx = new HeroFx($<HTMLCanvasElement>('#hero-fx'));
    this.heroFx.setTheme(this.resolvedBasemap() !== 'daylight');
    renderCompass($('#compass'));
    renderScope($('#scope'), null);
    this.renderLegend();
    this.renderPlaces();

    this.search = new SearchUI(
      $('#search-modal'),
      (h) => {
        this.pick({ lat: h.lat, lon: h.lon }, h.sub === 'Current location' ? undefined : h.name);
        if (h.sub === 'Current location') return this.backToMe();
        this.map.flyTo(h, 15.5);
        this.sheet.snap('peek', false);
      },
      () => {
        const out: SearchHit[] = [];
        if (this.gps) out.push({ name: 'My location', sub: 'Current location', lat: this.gps.lat, lon: this.gps.lon });
        this.saved.forEach((p) => out.push({ name: p.name, sub: 'Saved', lat: p.lat, lon: p.lon }));
        return out;
      }
    );

    $('#search-open').addEventListener('click', () => this.search.open());
    $('#btn-locate').addEventListener('click', () => (this.gps ? this.backToMe() : this.locate(true)));
    $('#btn-zoom-in').addEventListener('click', () => this.map.zoomBy(1));
    $('#btn-zoom-out').addEventListener('click', () => this.map.zoomBy(-1));
    $('#back-to-me').addEventListener('click', () => this.backToMe());
    $('#pick-mode').addEventListener('click', () => {
      const on = !$('#app').classList.contains('is-picking');
      $('#app').classList.toggle('is-picking', on);
      if (on) this.sheet.snap('peek');
    });
    $('#save-spot').addEventListener('click', () => this.toggleSave());
    $('#brand').addEventListener('click', () => openModal($('#about-modal')));
    $('#about-open').addEventListener('click', () => openModal($('#about-modal')));
    $('#btn-layers').addEventListener('click', () => this.openLayers());
    this.bindSettings();

    window.addEventListener('keydown', (e) => {
      const typing = (e.target as HTMLElement).closest('input, textarea');
      if (e.key === 'Escape') {
        if (!closeTopModal()) $('#app').classList.remove('is-picking');
        return;
      }
      if (typing || anyModalOpen() || e.metaKey || e.ctrlKey) return;
      if (e.key === '/') {
        e.preventDefault();
        this.search.open();
      } else if (e.key === ' ' && !(e.target as HTMLElement).closest('button')) {
        e.preventDefault();
        haptic('medium');
        this.togglePlay();
      } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !(e.target as HTMLElement).closest('.maplibregl-canvas, #tl-track')) {
        this.stopPlay();
        this.timeline.setIndex(this.timeline.current + (e.key === 'ArrowRight' ? 1 : -1));
      } else if (e.key.toLowerCase() === 'l') {
        this.gps ? this.backToMe() : this.locate(true);
      }
    });

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.installEvt = e as App['installEvt'];
      $('#install-btn').hidden = false;
    });
    $('#install-btn').addEventListener('click', async () => {
      if (!this.installEvt) return;
      await this.installEvt.prompt();
      this.installEvt = null;
      $('#install-btn').hidden = true;
    });
    const standalone = matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone;
    $('#install-ios').hidden = !(/iP(hone|ad|od)/.test(navigator.userAgent) && !standalone);
  }

  private backToMe() {
    if (!this.gps) return this.locate(true);
    this.setSpot({ lat: this.gps.lat, lon: this.gps.lon, kind: 'gps', name: nearestPlace(this.gps).name });
    this.map.flyTo(this.gps, 15.5);
    haptic('success');
  }

  private toggleSave() {
    const s = this.spot;
    if (!s) return;
    const existing = this.isSaved(s);
    if (existing) {
      this.saved = this.saved.filter((p) => p !== existing);
      toast(`Removed ${existing.name}`, { icon: 'star' });
    } else {
      const label = s.kind === 'gps' ? `${s.name} (here)` : s.name;
      this.saved = [...this.saved, { id: Math.random().toString(36).slice(2, 10), name: label, lat: s.lat, lon: s.lon }];
      toast(`Saved ${label}`, { icon: 'star' });
    }
    SAVED.save({ places: this.saved });
    this.renderSpotHeader();
    this.renderPlaces();
    void this.requestPoints();
  }

  private renderLegend() {
    const stops = [];
    for (let l = LEVEL_COUNT; l >= 1; l -= 4) stops.push(cssColor(this.settings.palette, l, 1));
    $('#tl-legend').style.background = `linear-gradient(180deg, ${stops.join(',')})`;
  }

  private openLayers() {
    openModal($('#layers-modal'));
    this.syncSettingsUI();
  }

  private syncSettingsUI() {
    const s = this.settings;
    const sel = (root: string, v: string) =>
      document.querySelectorAll<HTMLElement>(`${root} [data-value]`).forEach((b) => b.classList.toggle('is-selected', b.dataset.value === v));
    sel('#opt-basemap', s.basemap);
    sel('#opt-palette', s.palette);
    sel('#opt-cell', String(s.cellSize));
    const op = $<HTMLInputElement>('#opt-opacity');
    op.value = String(s.opacity);
    op.style.setProperty('--fill', `${((s.opacity - 30) / 70) * 100}%`);
    setText($('#opt-opacity-out'), `${s.opacity}%`);
    $<HTMLInputElement>('#opt-wind').checked = s.wind;
    $<HTMLInputElement>('#opt-grid').checked = s.grid;
    $<HTMLInputElement>('#opt-forecast').checked = s.forecastPlayback;
    $<HTMLInputElement>('#opt-haptics').checked = s.haptics;
    $<HTMLInputElement>('#opt-sound').checked = s.sound;
  }

  private saveSettings(patch: Partial<Settings>) {
    this.settings = { ...this.settings, ...patch };
    SETTINGS.save(this.settings);
    this.syncSettingsUI();
  }

  private bindSettings() {
    const choose = (root: string, fn: (v: string) => void) =>
      $(root).addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest<HTMLElement>('[data-value]');
        if (b) {
          haptic('selection');
          fn(b.dataset.value!);
        }
      });
    choose('#opt-basemap', (v) => {
      this.saveSettings({ basemap: v as BasemapSetting });
      this.applyBasemap();
    });
    choose('#opt-palette', (v) => {
      this.saveSettings({ palette: v as PaletteId });
      for (const r of RANGES) this.renderers[r].setPalette(v as PaletteId);
      this.map.setPalette(v as PaletteId);
      this.chart.setPalette(v as PaletteId);
      this.renderLegend();
      this.showFrame(this.timeline.current);
      this.renderSpot();
    });
    choose('#opt-cell', (v) => {
      this.saveSettings({ cellSize: Number(v) });
      if (this.spot) {
        this.map.setSpot(this.spot, this.settings.cellSize, this.spot.kind);
        this.renderSpotHeader();
        this.renderSpot();
      }
      this.scheduleGrid();
    });
    const op = $<HTMLInputElement>('#opt-opacity');
    let lastStep = -1;
    op.addEventListener('input', () => {
      const v = Number(op.value);
      if (v !== lastStep) haptic('selection');
      lastStep = v;
      this.saveSettings({ opacity: v });
      this.map.setRadarOpacity(v / 100);
    });
    const toggle = (id: string, key: keyof Settings, after: (v: boolean) => void) =>
      $<HTMLInputElement>(id).addEventListener('change', (e) => {
        const v = (e.target as HTMLInputElement).checked;
        this.saveSettings({ [key]: v } as Partial<Settings>);
        haptic(v ? 'light' : 'selection');
        after(v);
      });
    toggle('#opt-wind', 'wind', (v) => this.wind.setVisible(v));
    toggle('#opt-grid', 'grid', (v) => {
      this.map.setGridVisible(v);
      this.scheduleGrid();
    });
    toggle('#opt-forecast', 'forecastPlayback', () => undefined);
    toggle('#opt-haptics', 'haptics', () => configureHaptics(this.settings));
    toggle('#opt-sound', 'sound', () => configureHaptics(this.settings));
    $('#layers-modal').addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('[data-close]')) closeModal($('#layers-modal'));
    });
  }
}
