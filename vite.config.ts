import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // Relative base so the build works from any sub-path (e.g. GitHub Pages).
  base: './',
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  worker: { format: 'es' },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['icons/*.png', 'icons/*.svg'],
      manifest: {
        name: 'RainRain — Singapore Rain Radar',
        short_name: 'RainRain',
        description:
          'Hyperlocal rain radar for Singapore. Know if it is raining on your 5 m square, when it will start, and when it will stop.',
        theme_color: '#070b14',
        background_color: '#070b14',
        display: 'standalone',
        orientation: 'any',
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
        globPatterns: ['**/*.{js,css,html,woff2,png,svg}'],
        globIgnores: ['**/*cyrillic*', '**/*greek*', '**/*vietnamese*'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        navigateFallback: 'index.html',
        runtimeCaching: [
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
