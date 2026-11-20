import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { mediaMiddleware } from './server.js';

export default defineConfig({
  plugins: [vue(), {
    name: 'local-chart-media',
    configureServer(server) { server.middlewares.use(mediaMiddleware()); },
    configurePreviewServer(server) { server.middlewares.use(mediaMiddleware()); }
  }],
  server: { host: '127.0.0.1', port: 4173 },
  preview: { host: '127.0.0.1', port: 4173 }
});