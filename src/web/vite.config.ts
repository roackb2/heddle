import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: __dirname,
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/trpc': {
        target: process.env.HEDDLE_SERVER_URL ?? 'http://127.0.0.1:8765',
        changeOrigin: true,
      },
      '/control-plane': {
        target: process.env.HEDDLE_SERVER_URL ?? 'http://127.0.0.1:8765',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: resolve(__dirname, '../../dist/src/web'),
    emptyOutDir: true,
  },
});
