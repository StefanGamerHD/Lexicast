import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

// Builds the editor UI from web/ into dist/web. The Node server serves the result; Vite is a dev-time tool only.
export default defineConfig({
  root: 'web',
  plugins: [svelte()],
  build: {
    outDir: '../dist/web',
    emptyOutDir: true,
    assetsDir: 'static',
    // no inline polyfill script: the CSP allows scripts from 'self' only
    modulePreload: { polyfill: false },
    // keep every asset a real file, so nothing depends on data: URLs
    assetsInlineLimit: 0,
    target: 'es2022',
  },
  server: {
    port: 5173,
    // dev: run the API with LEXICAST_BASE_URL=http://localhost:5173 so origin checks and cookies match
    proxy: { '/api': 'http://127.0.0.1:8787' },
  },
});
