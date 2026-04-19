import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  root: __dirname,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': __dirname,
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: ['.ts.net'],
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
