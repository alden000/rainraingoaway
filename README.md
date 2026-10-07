# RainRain — Singapore rain radar, to the square

A Progressive Web App (phone, tablet, desktop) that reads NEA's live weather radar and tells you whether it is raining on **your 5 × 5 m square** of Singapore, when rain will start or stop in the next 30 minutes, what is heading your way beyond that, and which way the wind is steering the showers.

## Features

- **Live radar** from NEA via [data.gov.sg](https://data.gov.sg) (`/weather-radar-images/70km` and `/240km`), refreshed every 5 minutes, two hours of history.
- **Custom basemaps**: Midnight, Daylight, Satellite (plus Auto), built on OpenFreeMap vector tiles and covering Singapore plus 10 km.
- **5 m analysis grid** aligned to Singapore's SVY21 national grid (EPSG:3414). Your cell's reading is bilinearly interpolated from the ~290 m radar pixels. The grid coarsens automatically when you zoom out.
- **Pick any spot**: tap the map, search (OneMap), or save places. Saved places get their own status.
- **30-minute nowcast**: the app tracks rain echoes between scans by block matching, carries the latest scan forward along that motion, and gives a probability that widens with lead time. Output reads like *Rain in ~15 min* or *Easing in ~20 min*.
- **Beyond 30 minutes**: a point forecast out to 3 hours. It also follows the flow upwind across the 240 km image to find the next rain band and estimate when it arrives.
- **Steering wind**: direction and speed estimated from the echo motion, with a confidence rating, plus an animated wind-flow layer on the map.
- **Ground clutter filtering**: echoes that stay perfectly still from scan to scan are ignored.
- **Timeline**: scrub or play −2 h of history and +60 min of forecast imagery, with cross-fades between frames.
- **Tactile UI**: haptics via the Vibration API, or the native switch haptic on iOS 18+. Spring animations and optional interface sounds. Respects `prefers-reduced-motion`.
- **PWA**: installable and works offline from the last cached scans (IndexedDB) and cached basemap tiles.
- **Private**: your location stays on your device. Place labels come from a built-in gazetteer.

## Develop

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # engine + insight unit tests
npm run build      # type-check + production build to dist/
npm run preview    # serve the production build
```

Geolocation needs a secure context. `localhost` counts, but to test on a phone use HTTPS (e.g. `vite --host` behind a tunnel).

## Deploy

`dist/` is a static site that works from any path. The included workflow (`.github/workflows/deploy.yml`) publishes it to GitHub Pages on every push to `main`. To turn it on, go to **Settings → Pages → Source: GitHub Actions**.

## How the forecast works

| Stage | Where |
| --- | --- |
| Decode PNG colours → 33 legend levels → mm/h | `src/radar/palette.ts`, `src/radar/api.ts` |
| Clutter mask, block-matching motion field, growth/decay trend | `src/radar/motion.ts` |
| Semi-Lagrangian advection, neighbourhood probability, upstream search | `src/radar/nowcast.ts` |
| Runs off the main thread | `src/radar/analysis.worker.ts` |
| Plain-language summaries | `src/radar/insights.ts` |

Limits: radar extrapolation can't predict showers that form out of nothing, which is common in Singapore's afternoon convection. Confidence drops quickly past about 60 minutes. The "wind" is the steering flow a few kilometres up, not street-level gusts.

## Credits

Radar: National Environment Agency via data.gov.sg (Singapore Open Data Licence). Basemap: OpenFreeMap / OpenMapTiles / © OpenStreetMap contributors. Imagery: Esri. Search: OneMap (Singapore Land Authority).
