import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/web'),
    },
  },
  test: {
    include: ['src/__tests__/**/*.test.{ts,tsx}'],
    exclude: ['dist/**', 'node_modules/**'],
  },
});
