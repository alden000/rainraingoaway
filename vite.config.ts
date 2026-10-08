import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { execSync } from 'node:child_process';
import type { Plugin } from 'vite';

// Short commit + build time, shown in the app so it's easy to tell which version is running.
const sha = (process.env.GITHUB_SHA ?? (() => {
  try {
    return execSync('git rev-parse HEAD').toString().trim();
  } catch {
    return 'dev';
  }
})()).slice(0, 7);
const built = new Date().toLocaleString('en-SG', { timeZone: 'Asia/Singapore', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });

export default defineConfig({
  // Relative base so the build works from any sub-path (e.g. GitHub Pages).
  base: './',
  define: {
    __BUILD__: JSON.stringify(`${sha} · ${built}`),
    __BUILD_SHA__: JSON.stringify(sha)
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        // The map engine rarely changes: keep it in its own long-lived chunk so
        // app updates don't make everyone re-download ~1 MB.
        manualChunks: (id) => (id.includes('node_modules/maplibre-gl') ? 'maplibre' : undefined)
      }
    }
  },
  worker: { format: 'es' },
  plugins: [
    versionFile(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['icons/*.png', 'icons/*.svg'],
      manifest: {
        name: 'RainRain — Singapore Rain Radar',
        short_name: 'RainRain',
        description:
          'Hyperlocal rain radar for Singapore. Know if it is raining on your 50 m square, when it will start, and when it will stop.',
        theme_color: '#070b14',
        background_color: '#070b14',
        display: 'standalone',
        orientation: 'any',
        // Explicit, permanent app identity (resolved against start_url). Without
        // it Chrome derives the id from start_url; a stale install record under
        // that implicit id was blocking re-installs ("already installed").
        id: '/rainraingoaway/?app=rainrain',
        start_url: './',
        scope: './',
        categories: ['weather', 'utilities'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        // HTML is deliberately not precached: it is served network-first (below)
        // so a new deploy shows up on the next load instead of one visit later.
        globPatterns: ['**/*.{js,css,woff2,png,svg}'],
        globIgnores: ['**/*cyrillic*', '**/*greek*', '**/*vietnamese*'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        navigateFallback: null,
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'pages',
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 4 },
              cacheableResponse: { statuses: [200] }
            }
          },
          {
            // Basemap vector tiles, glyphs, sprites and styles.
            urlPattern: /^https:\/\/tiles\.openfreemap\.org\/.*/,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'basemap-vector',
              expiration: { maxEntries: 3000, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] }
            }
          },
          {
            urlPattern: /^https:\/\/server\.arcgisonline\.com\/.*/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'basemap-imagery',
              expiration: { maxEntries: 1500, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] }
            }
          }
        ]
      }
    })
  ]
});

/** Emits version.json so running copies can tell when a newer build is deployed. */
function versionFile(): Plugin {
  return {
    name: 'rainrain-version-file',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: sha, built }) });
    }
  };
}
