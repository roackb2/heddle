import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: import.meta.dirname,
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('../../src', import.meta.url)),
      '@heddleagent/runtime/advanced': fileURLToPath(
        new URL('../../src/advanced.ts', import.meta.url),
      ),
      '@heddleagent/runtime/heartbeat/testing': fileURLToPath(
        new URL('../../src/heartbeat-testing.ts', import.meta.url),
      ),
      '@heddleagent/execution-host-client/conversation': fileURLToPath(
        new URL('../execution-host-client/src/conversation/index.ts', import.meta.url),
      ),
      '@heddleagent/execution-host-client/testing': fileURLToPath(
        new URL('../execution-host-client/src/testing/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['dist/**', 'node_modules/**'],
    sequence: { concurrent: false },
  },
});
