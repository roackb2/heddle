import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: import.meta.dirname,
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('../../src', import.meta.url)),
      '@roackb2/heddle/advanced': fileURLToPath(
        new URL('../../src/advanced.ts', import.meta.url),
      ),
      '@roackb2/heddle/heartbeat/testing': fileURLToPath(
        new URL('../../src/heartbeat-testing.ts', import.meta.url),
      ),
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['dist/**', 'node_modules/**'],
    sequence: { concurrent: false },
  },
});
