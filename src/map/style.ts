/**
 * Bespoke cartography built on OpenFreeMap's OpenMapTiles vector tiles.
 * Two hand-tuned palettes ("Midnight" and "Daylight") plus a satellite
 * variant that keeps our own label treatment on top of Esri imagery.
 */
import type { StyleSpecification, LayerSpecification, ExpressionSpecification } from 'maplibre-gl';

export type BasemapId = 'midnight' | 'daylight' | 'satellite';

interface Palette {
  bg: string;
  water: string;
  waterLine: string;
  park: string;
  wood: string;
  residential: string;
  industrial: string;
  building: string;
  buildingLine: string;
  road: string;
  roadMajor: string;
  motorway: string;
  rail: string;
  boundary: string;
  label: string;
  labelMajor: string;
  halo: string;
  waterLabel: string;
  aeroway: string;
}

const MIDNIGHT: Palette = {
  bg: '#0a0f1c',
  water: '#050a14',
  waterLine: '#16243d',
  park: '#0d1a1b',
  wood: '#0d1c1a',
  residential: '#0d1322',
  industrial: '#0f1424',
  building: '#151c2e',
  buildingLine: '#1c2540',
  road: '#1b2338',
  roadMajor: '#26304a',
  motorway: '#34405e',
  rail: '#2a3350',
  boundary: '#5b6b95',
  label: '#7d8bb0',
  labelMajor: '#c7d2fe',
  halo: '#0a0f1c',
  waterLabel: '#3b5a8a',
  aeroway: '#1a2238'
};

const DAYLIGHT: Palette = {
  bg: '#f3f0e8',
  water: '#c9dbe6',
  waterLine: '#b4cad8',
  park: '#dfe8d4',
  wood: '#d6e3cb',
  residential: '#ece8de',
  industrial: '#e6e2dc',
  building: '#e2ddd2',
  buildingLine: '#d4cec1',
  road: '#ffffff',
  roadMajor: '#ffffff',
  motorway: '#f7e3c4',
  rail: '#c9c2b5',
  boundary: '#9a8fb0',
  label: '#6b6f7b',
  labelMajor: '#1f2433',
  halo: '#f6f3ec',
  waterLabel: '#6c8ea5',
  aeroway: '#e4e0d6'
};

const SAT_LABELS: Palette = {
  ...MIDNIGHT,
  label: '#e6ebff',
  labelMajor: '#ffffff',
  halo: 'rgba(0,0,0,0.75)',
  road: 'rgba(255,255,255,0.18)',
  roadMajor: 'rgba(255,255,255,0.28)',
  motorway: 'rgba(255,214,150,0.45)',
  waterLabel: '#bcd5ff',
  boundary: '#ffffff'
};

const SRC = 'omt';
const name: ExpressionSpecification = ['coalesce', ['get', 'name:en'], ['get', 'name_en'], ['get', 'name']];
const isPoly: ExpressionSpecification = ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false];
const isLine: ExpressionSpecification = ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false];

function baseLayers(p: Palette): LayerSpecification[] {
  return [
    { id: 'background', type: 'background', paint: { 'background-color': p.bg } },
    {
      id: 'landuse-res', type: 'fill', source: SRC, 'source-layer': 'landuse',
      filter: ['all', isPoly, ['match', ['get', 'class'], ['residential', 'suburb', 'neighbourhood'], true, false]],
      paint: { 'fill-color': p.residential }
    },
    {
      id: 'landuse-ind', type: 'fill', source: SRC, 'source-layer': 'landuse',
      filter: ['all', isPoly, ['match', ['get', 'class'], ['industrial', 'commercial', 'retail', 'railway', 'garages'], true, false]],
      paint: { 'fill-color': p.industrial }
    },
    {
      id: 'landcover-wood', type: 'fill', source: SRC, 'source-layer': 'landcover',
      filter: ['all', isPoly, ['match', ['get', 'class'], ['wood', 'forest', 'wetland'], true, false]],
      paint: { 'fill-color': p.wood }
    },
    {
      id: 'landcover-grass', type: 'fill', source: SRC, 'source-layer': 'landcover',
      filter: ['all', isPoly, ['match', ['get', 'class'], ['grass', 'farmland', 'scrub'], true, false]],
      paint: { 'fill-color': p.park, 'fill-opacity': 0.8 }
    },
    {
      id: 'park', type: 'fill', source: SRC, 'source-layer': 'park', filter: isPoly,
      paint: { 'fill-color': p.park }
    },
    {
      id: 'water', type: 'fill', source: SRC, 'source-layer': 'water',
      filter: ['all', isPoly, ['!=', ['get', 'brunnel'], 'tunnel']],
      paint: { 'fill-color': p.water }
    },
    {
      id: 'water-edge', type: 'line', source: SRC, 'source-layer': 'water', filter: isPoly,
      paint: { 'line-color': p.waterLine, 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.4, 16, 1.4], 'line-blur': 0.6 }
    },
    {
      id: 'waterway', type: 'line', source: SRC, 'source-layer': 'waterway', filter: isLine,
      paint: { 'line-color': p.water, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.5, 17, 3] }
    },
    {
      id: 'aeroway', type: 'fill', source: SRC, 'source-layer': 'aeroway', minzoom: 11, filter: isPoly,
      paint: { 'fill-color': p.aeroway }
    },
    {
      id: 'building', type: 'fill', source: SRC, 'source-layer': 'building', minzoom: 13,
      paint: {
        'fill-color': p.building,
        'fill-outline-color': p.buildingLine,
        'fill-opacity': ['interpolate', ['linear'], ['zoom'], 13, 0, 14.5, 1]
      }
    },
    ...roads(p)
  ];
}

function roads(p: Palette): LayerSpecification[] {
  const cls = (c: string[]): ExpressionSpecification => ['match', ['get', 'class'], c, true, false];
  const notTunnel: ExpressionSpecification = ['!=', ['get', 'brunnel'], 'tunnel'];
  return [
    {
      id: 'road-minor', type: 'line', source: SRC, 'source-layer': 'transportation', minzoom: 12,
      filter: ['all', isLine, notTunnel, cls(['minor', 'service', 'track'])],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': p.road, 'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 12, 0.4, 18, 10] }
    },
    {
      id: 'road-path', type: 'line', source: SRC, 'source-layer': 'transportation', minzoom: 15,
      filter: ['all', isLine, cls(['path'])],
      paint: { 'line-color': p.road, 'line-width': 0.8, 'line-dasharray': [2, 2] }
    },
    {
      id: 'road-major', type: 'line', source: SRC, 'source-layer': 'transportation', minzoom: 9,
      filter: ['all', isLine, notTunnel, cls(['primary', 'secondary', 'tertiary', 'trunk'])],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': p.roadMajor, 'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 9, 0.5, 18, 16] }
    },
    {
      id: 'road-motorway', type: 'line', source: SRC, 'source-layer': 'transportation', minzoom: 8,
      filter: ['all', isLine, notTunnel, cls(['motorway'])],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': p.motorway, 'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 8, 0.8, 18, 20] }
    },
    {
      id: 'rail', type: 'line', source: SRC, 'source-layer': 'transportation', minzoom: 11,
      filter: ['all', isLine, cls(['rail', 'transit'])],
      paint: { 'line-color': p.rail, 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.6, 18, 2.5], 'line-dasharray': [3, 2] }
    },
    {
      id: 'boundary', type: 'line', source: SRC, 'source-layer': 'boundary',
      filter: ['all', ['<=', ['get', 'admin_level'], 2], ['!=', ['get', 'maritime'], 1]],
      paint: { 'line-color': p.boundary, 'line-width': 1.2, 'line-dasharray': [4, 3], 'line-opacity': 0.55 }
    },
    {
      id: 'boundary-maritime', type: 'line', source: SRC, 'source-layer': 'boundary',
      filter: ['all', ['<=', ['get', 'admin_level'], 2], ['==', ['get', 'maritime'], 1]],
      paint: { 'line-color': p.boundary, 'line-width': 1, 'line-dasharray': [1, 3], 'line-opacity': 0.35 }
    }
  ];
}

function labelLayers(p: Palette): LayerSpecification[] {
  const font = ['Noto Sans Regular'];
  const bold = ['Noto Sans Bold'];
  const italic = ['Noto Sans Italic'];
  return [
    {
      id: 'label-water', type: 'symbol', source: SRC, 'source-layer': 'water_name',
      layout: { 'text-field': name, 'text-font': italic, 'text-size': 12, 'text-letter-spacing': 0.2, 'text-max-width': 6 },
      paint: { 'text-color': p.waterLabel, 'text-halo-color': p.halo, 'text-halo-width': 1 }
    },
    {
      id: 'label-road', type: 'symbol', source: SRC, 'source-layer': 'transportation_name', minzoom: 14,
      filter: isLine,
      layout: {
        'symbol-placement': 'line', 'text-field': name, 'text-font': font,
        'text-size': ['interpolate', ['linear'], ['zoom'], 14, 10, 18, 13], 'text-max-angle': 30
      },
      paint: { 'text-color': p.label, 'text-halo-color': p.halo, 'text-halo-width': 1.4 }
    },
    {
      id: 'label-neighbourhood', type: 'symbol', source: SRC, 'source-layer': 'place', minzoom: 13,
      filter: ['match', ['get', 'class'], ['neighbourhood', 'quarter', 'hamlet', 'isolated_dwelling'], true, false],
      layout: { 'text-field': name, 'text-font': font, 'text-size': 11, 'text-max-width': 8 },
      paint: { 'text-color': p.label, 'text-halo-color': p.halo, 'text-halo-width': 1.2 }
    },
    {
      id: 'label-suburb', type: 'symbol', source: SRC, 'source-layer': 'place', minzoom: 10.5, maxzoom: 16,
      filter: ['match', ['get', 'class'], ['suburb', 'village', 'town'], true, false],
      layout: {
        'text-field': name, 'text-font': bold, 'text-transform': 'uppercase', 'text-letter-spacing': 0.18,
        'text-size': ['interpolate', ['linear'], ['zoom'], 11, 10, 15, 13], 'text-max-width': 8
      },
      paint: { 'text-color': p.label, 'text-halo-color': p.halo, 'text-halo-width': 1.4 }
    },
    {
      id: 'label-city', type: 'symbol', source: SRC, 'source-layer': 'place', maxzoom: 12,
      filter: ['match', ['get', 'class'], ['city', 'state', 'country'], true, false],
      layout: { 'text-field': name, 'text-font': bold, 'text-size': 15, 'text-letter-spacing': 0.3, 'text-transform': 'uppercase' },
      paint: { 'text-color': p.labelMajor, 'text-halo-color': p.halo, 'text-halo-width': 1.6 }
    }
  ];
}

export function buildStyle(id: BasemapId): StyleSpecification {
  const p = id === 'daylight' ? DAYLIGHT : id === 'satellite' ? SAT_LABELS : MIDNIGHT;
  const layers: LayerSpecification[] =
    id === 'satellite'
      ? [
          { id: 'background', type: 'background', paint: { 'background-color': '#05070d' } },
          {
            id: 'imagery', type: 'raster', source: 'imagery',
            paint: { 'raster-saturation': -0.25, 'raster-brightness-max': 0.82, 'raster-contrast': 0.08 }
          },
          ...roads(p).filter((l) => l.id.startsWith('road') || l.id.startsWith('boundary'))
        ]
      : baseLayers(p);

  return {
    version: 8,
    name: `RainRain ${id}`,
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: {
      [SRC]: { type: 'vector', url: 'https://tiles.openfreemap.org/planet', attribution: '© OpenMapTiles © OpenStreetMap contributors · OpenFreeMap' },
      ...(id === 'satellite'
        ? {
            imagery: {
              type: 'raster' as const,
              tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
              tileSize: 256,
              maxzoom: 19,
              attribution: 'Imagery © Esri, Maxar, Earthstar Geographics'
            }
          }
        : {})
    },
    layers: [...layers, ...labelLayers(p)]
  };
}

/** Id of the first label layer — overlays are inserted beneath it so place names stay legible. */
export const FIRST_LABEL_LAYER = 'label-water';
