import { defineConfig } from 'vite';
export default defineConfig({
  server: { host: '0.0.0.0', proxy: { '/socket': { target: 'ws://127.0.0.1:8080', ws: true } } },
  build: { target: 'es2022' },
});
