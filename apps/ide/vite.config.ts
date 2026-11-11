import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  resolve: {
    alias: { '@blockforge/core': fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)) },
  },
  server: {
    port: 1420,
    strictPort: true,
    host: host || '127.0.0.1',
    watch: { ignored: ['**/src-tauri/**'] },
  },
  preview: { port: 1421, strictPort: true, host: '127.0.0.1' },
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['pyodide'] },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 6000,
    sourcemap: false,
  },
});
