/** MapLibre wrapper: basemap, radar overlay, analysis grid, markers. */
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, CanvasSource, ExpressionSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// MapLibre resolves its worker relative to its own module URL, which bundling breaks.
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { COVERAGE_BBOX, RADAR_BBOX, RANGES, SINGAPORE_BBOX, SINGAPORE_CENTER, type RadarRange } from '../config';
import type { LatLon } from '../lib/geo';
import { cellAt } from '../lib/svy21';
import { LEVEL_COUNT, cssColor, levelToRate, type PaletteId } from '../radar/palette';
import { buildStyle, FIRST_LABEL_LAYER, type BasemapId } from './style';

export interface MapOptions {
  container: HTMLElement;
  basemap: BasemapId;
  radarCanvases: Record<RadarRange, HTMLCanvasElement>;
  onPick: (p: LatLon) => void;
  onMove: () => void;
}

maplibregl.setWorkerUrl(maplibreWorkerUrl);

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

function paddedRegion(): [[number, number], [number, number]] {
  const padLon = (COVERAGE_BBOX.east - COVERAGE_BBOX.west) * 0.08;
  const padLat = (COVERAGE_BBOX.north - COVERAGE_BBOX.south) * 0.08;
  return [
    [COVERAGE_BBOX.west - padLon, COVERAGE_BBOX.south - padLat],
    [COVERAGE_BBOX.east + padLon, COVERAGE_BBOX.north + padLat]
  ];
}

export class RadarMap {
  readonly map: maplibregl.Map;
  private radarCanvases: Record<RadarRange, HTMLCanvasElement>;
  private spotMarker: maplibregl.Marker | null = null;
  private userMarker: maplibregl.Marker | null = null;
  private gridData: GeoJSON.FeatureCollection = EMPTY;
  private cellData: GeoJSON.FeatureCollection = EMPTY;
  private accuracyData: GeoJSON.FeatureCollection = EMPTY;
  private palette: PaletteId = 'signature';
  private radarOpacity = 0.85;
  private gridVisible = true;
  private basemap: BasemapId;
  private repaintTimer = 0;
  readonly ready: Promise<void>;

  constructor(opts: MapOptions) {
    this.radarCanvases = opts.radarCanvases;
    this.basemap = opts.basemap;
    this.map = new maplibregl.Map({
      container: opts.container,
      style: buildStyle(opts.basemap),
      center: [SINGAPORE_CENTER.lon, SINGAPORE_CENTER.lat],
      zoom: 10.4,
      minZoom: 5,
      maxZoom: 19.5,
      maxBounds: paddedRegion(),
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
      fadeDuration: 180,
      cooperativeGestures: false
    });
    this.map.touchZoomRotate.disableRotation();
    this.map.keyboard.disableRotation();
    this.map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
    // Start collapsed to the (i) button; it expands on tap.
    this.map.once('load', () =>
      opts.container.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show')
    );
    this.map.on('style.load', () => this.installOverlays());
    this.map.on('click', (e) => opts.onPick({ lat: e.lngLat.lat, lon: e.lngLat.lng }));
    this.map.on('moveend', () => opts.onMove());
    this.ready = new Promise((res) => this.map.once('load', () => res()));
  }

  fitSingapore(animate = false) {
    this.map.fitBounds(
      [[SINGAPORE_BBOX.west, SINGAPORE_BBOX.south], [SINGAPORE_BBOX.east, SINGAPORE_BBOX.north]],
      { padding: this.padding(), animate, duration: 1400 }
    );
  }

  /** Space taken by floating UI so focus targets land in the visible area. */
  private padding() {
    const w = window.innerWidth;
    if (w >= 900) return { top: 90, bottom: 130, left: 460, right: 90 };
    return { top: 90, bottom: Math.round(window.innerHeight * 0.36), left: 24, right: 72 };
  }

  setBasemap(id: BasemapId) {
    if (id === this.basemap) return;
    this.basemap = id;
    this.map.setStyle(buildStyle(id), { diff: false });
  }

  private installOverlays() {
    const m = this.map;
    const before = m.getLayer(FIRST_LABEL_LAYER) ? FIRST_LABEL_LAYER : undefined;
    const dark = this.basemap !== 'daylight';

    // Widest first so the finer ranges draw on top.
    for (const r of [...RANGES].reverse()) {
      const b = RADAR_BBOX[r];
      m.addSource(`radar-${r}`, {
        type: 'canvas',
        canvas: this.radarCanvases[r],
        animate: false,
        coordinates: [[b.west, b.north], [b.east, b.north], [b.east, b.south], [b.west, b.south]]
      });
      m.addLayer(
        {
          id: `radar-${r}`,
          type: 'raster',
          source: `radar-${r}`,
          paint: { 'raster-opacity': this.radarOpacity, 'raster-resampling': 'linear', 'raster-fade-duration': 0 }
        },
        before
      );
    }

    m.addSource('grid', { type: 'geojson', data: this.gridData });
    m.addLayer(
      {
        id: 'grid-fill', type: 'fill', source: 'grid', minzoom: 12, filter: ['==', ['geometry-type'], 'Polygon'],
        paint: {
          'fill-color': this.gridColor(),
          'fill-opacity': [
            'interpolate', ['linear'], ['zoom'],
            12, ['case', ['>=', ['get', 'r'], 0.1], 0.18, 0],
            16, ['case', ['>=', ['get', 'r'], 0.1], 0.32, 0],
            19, ['case', ['>=', ['get', 'r'], 0.1], 0.42, 0]
          ]
        }
      },
      before
    );
    m.addLayer(
      {
        id: 'grid-line', type: 'line', source: 'grid', minzoom: 12, filter: ['==', ['geometry-type'], 'LineString'],
        paint: {
          'line-color': dark ? '#c7d2fe' : '#1e293b',
          'line-opacity': ['interpolate', ['linear'], ['zoom'], 12, 0.06, 17, 0.16, 19, 0.24],
          'line-width': 0.6
        }
      },
      before
    );

    m.addSource('accuracy', { type: 'geojson', data: this.accuracyData });
    m.addLayer({
      id: 'accuracy', type: 'fill', source: 'accuracy',
      paint: { 'fill-color': '#60a5fa', 'fill-opacity': 0.08, 'fill-outline-color': 'rgba(96,165,250,0.4)' }
    });

    m.addSource('cell', { type: 'geojson', data: this.cellData });
    m.addLayer({
      id: 'cell-glow', type: 'line', source: 'cell',
      paint: { 'line-color': '#a5b4fc', 'line-width': 8, 'line-blur': 6, 'line-opacity': 0.55 }
    });
    m.addLayer({
      id: 'cell-line', type: 'line', source: 'cell',
      paint: { 'line-color': dark ? '#ffffff' : '#312e81', 'line-width': 1.6 }
    });
    this.setGridVisible(this.gridVisible);
    this.repaintRadar();
  }

  private gridColor(): ExpressionSpecification {
    const stops: Array<number | string> = [];
    for (let l = 1; l <= LEVEL_COUNT; l += 2) stops.push(levelToRate(l), cssColor(this.palette, l, 1));
    return ['interpolate', ['linear'], ['get', 'r'], ...stops] as unknown as ExpressionSpecification;
  }

  setPalette(p: PaletteId) {
    this.palette = p;
    if (this.map.getLayer('grid-fill')) this.map.setPaintProperty('grid-fill', 'fill-color', this.gridColor());
  }

  setRadarOpacity(o: number) {
    this.radarOpacity = o;
    for (const r of RANGES) {
      if (this.map.getLayer(`radar-${r}`)) this.map.setPaintProperty(`radar-${r}`, 'raster-opacity', o);
    }
  }

  setGridVisible(v: boolean) {
    this.gridVisible = v;
    for (const id of ['grid-fill', 'grid-line']) {
      if (this.map.getLayer(id)) this.map.setLayoutProperty(id, 'visibility', v ? 'visible' : 'none');
    }
  }

  /** Push the latest canvas contents to the GPU. */
  private radarSources(): CanvasSource[] {
    return RANGES.map((r) => this.map.getSource(`radar-${r}`) as CanvasSource | undefined).filter((s): s is CanvasSource => !!s);
  }

  repaintRadar() {
    const srcs = this.radarSources();
    if (!srcs.length) return;
    srcs.forEach((s) => s.play());
    this.map.triggerRepaint();
    clearTimeout(this.repaintTimer);
    this.repaintTimer = window.setTimeout(() => srcs.forEach((s) => s.pause()), 120);
  }

  /** Continuous upload while animating (timeline playback). */
  setRadarAnimating(on: boolean) {
    const srcs = this.radarSources();
    if (!srcs.length) return;
    clearTimeout(this.repaintTimer);
    if (on) srcs.forEach((s) => s.play());
    else this.repaintRadar();
  }

  setGrid(fc: GeoJSON.FeatureCollection) {
    this.gridData = fc;
    (this.map.getSource('grid') as GeoJSONSource | undefined)?.setData(fc);
  }

  setSpot(p: LatLon, cellSize: number, kind: 'gps' | 'pick') {
    const cell = cellAt(p.lat, p.lon, cellSize);
    this.cellData = {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [cell.ring] } }]
    };
    (this.map.getSource('cell') as GeoJSONSource | undefined)?.setData(this.cellData);

    if (kind === 'pick') {
      if (!this.spotMarker) {
        const el = document.createElement('div');
        el.className = 'spot-pin';
        el.innerHTML = '<div class="spot-pin__shadow"></div><div class="spot-pin__body"><div class="spot-pin__dot"></div></div>';
        this.spotMarker = new maplibregl.Marker({ element: el, anchor: 'bottom' });
      }
      this.spotMarker.setLngLat([p.lon, p.lat]).addTo(this.map);
      const el = this.spotMarker.getElement();
      el.classList.remove('is-dropping');
      void el.offsetWidth;
      el.classList.add('is-dropping');
    } else {
      this.spotMarker?.remove();
    }
  }

  setUserLocation(p: LatLon | null, accuracyM = 0) {
    if (!p) {
      this.userMarker?.remove();
      this.accuracyData = EMPTY;
    } else {
      if (!this.userMarker) {
        const el = document.createElement('div');
        el.className = 'user-dot';
        el.innerHTML = '<span class="user-dot__ring"></span><span class="user-dot__ring user-dot__ring--2"></span><span class="user-dot__core"></span>';
        this.userMarker = new maplibregl.Marker({ element: el });
      }
      this.userMarker.setLngLat([p.lon, p.lat]).addTo(this.map);
      this.accuracyData = circle(p, Math.min(accuracyM, 2000));
    }
    (this.map.getSource('accuracy') as GeoJSONSource | undefined)?.setData(this.accuracyData);
  }

  flyTo(p: LatLon, zoom?: number) {
    this.map.flyTo({
      center: [p.lon, p.lat],
      zoom: zoom ?? Math.max(this.map.getZoom(), 14.5),
      padding: this.padding(),
      speed: 1.2,
      curve: 1.5,
      essential: true
    });
  }

  zoomBy(d: number) {
    this.map.easeTo({ zoom: this.map.getZoom() + d, duration: 380 });
  }

  bounds() {
    const b = this.map.getBounds();
    return { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() };
  }

  zoom() {
    return this.map.getZoom();
  }
}

function circle(c: LatLon, radiusM: number): GeoJSON.FeatureCollection {
  if (radiusM <= 0) return EMPTY;
  const pts: Array<[number, number]> = [];
  const dLat = radiusM / 110574;
  const dLon = radiusM / (111320 * Math.cos((c.lat * Math.PI) / 180));
  for (let i = 0; i <= 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    pts.push([c.lon + dLon * Math.cos(a), c.lat + dLat * Math.sin(a)]);
  }
  return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [pts] } }] };
}
