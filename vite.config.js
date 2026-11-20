import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  plugins: [
    vue(),
    VitePWA({
      injectRegister: 'script',
      registerType: 'prompt',
      includeAssets: ['icons/*.png'],
      manifest: {
        id: './',
        name: 'Web TJA Studio',
        short_name: 'TJA Studio',
        description: 'A local-first TJA chart and audio editor.',
        lang: 'zh-CN',
        start_url: './',
        scope: './',
        display: 'standalone',
        theme_color: '#16745b',
        background_color: '#f5f7f4',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,webmanifest}'],
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/media\//],
        cleanupOutdatedCaches: true,
        skipWaiting: false,
        clientsClaim: false
      }
    })
  ],
  server: { host: '127.0.0.1', port: 4173 },
  preview: { host: '127.0.0.1', port: 4173 }
});