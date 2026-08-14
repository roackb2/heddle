import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@web': resolve(__dirname, 'src/web-v2'),
      '@heddleagent/runtime/cli': resolve(__dirname, 'src/cli-runtime.ts'),
    },
  },
  test: {
    include: ['src/__tests__/**/*.test.{ts,tsx}'],
    exclude: ['dist/**', 'node_modules/**'],
  },
});
