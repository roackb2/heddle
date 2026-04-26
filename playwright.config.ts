import { defineConfig, devices } from '@playwright/test';

const clientPort = process.env.HEDDLE_E2E_CLIENT_PORT ?? '5174';
const controlPlaneUrl = process.env.HEDDLE_E2E_BASE_URL ?? `http://127.0.0.1:${clientPort}`;
const serverPort = process.env.HEDDLE_E2E_SERVER_PORT ?? '9876';
const serverUrl = `http://127.0.0.1:${serverPort}`;

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: controlPlaneUrl,
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'node scripts/e2e-daemon.mjs',
      url: `${serverUrl}/trpc/controlPlane.state?batch=1&input=%7B%7D`,
      reuseExistingServer: false,
      timeout: 30_000,
      env: {
        HEDDLE_E2E_SERVER_PORT: serverPort,
      },
    },
    {
      command: `yarn client:dev --host 127.0.0.1 --port ${clientPort}`,
      url: controlPlaneUrl,
      reuseExistingServer: false,
      timeout: 30_000,
      env: {
        HEDDLE_SERVER_URL: serverUrl,
      },
    },
  ],
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
