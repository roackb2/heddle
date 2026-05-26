import { defineConfig, devices } from '@playwright/test';

const clientPort = process.env.HEDDLE_BROWSER_INTEGRATION_CLIENT_PORT ?? '15174';
const controlPlaneUrl = process.env.HEDDLE_BROWSER_INTEGRATION_BASE_URL ?? `http://127.0.0.1:${clientPort}`;
const clientV2Port = process.env.HEDDLE_BROWSER_INTEGRATION_CLIENT_V2_PORT ?? '15175';
const controlPlaneV2Url = process.env.HEDDLE_BROWSER_INTEGRATION_V2_BASE_URL ?? `http://127.0.0.1:${clientV2Port}`;
const serverPort = process.env.HEDDLE_BROWSER_INTEGRATION_SERVER_PORT ?? '19876';
const serverUrl = `http://127.0.0.1:${serverPort}`;
const target = process.env.HEDDLE_BROWSER_INTEGRATION_TARGET;
const runWebV1 = target === 'web-v1';
const runWebV2 = target !== 'web-v1';

const webServers = [
  {
    command: 'node scripts/browser-integration-daemon.mjs',
    url: `${serverUrl}/trpc/controlPlane.state?batch=1&input=%7B%7D`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      HEDDLE_BROWSER_INTEGRATION_SERVER_PORT: serverPort,
    },
  },
  ...(runWebV1 ? [{
    command: `yarn client:dev:v1 --host 127.0.0.1 --port ${clientPort}`,
    url: controlPlaneUrl,
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      HEDDLE_SERVER_URL: serverUrl,
    },
  }] : []),
  ...(runWebV2 ? [{
    command: `yarn client:dev --host 127.0.0.1 --port ${clientV2Port}`,
    url: controlPlaneV2Url,
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      HEDDLE_SERVER_URL: serverUrl,
    },
  }] : []),
];

const projects = [
  ...(runWebV1 ? [{
    name: 'web-v1-chromium',
    testMatch: /web-v1\/.*\.spec\.ts/,
    use: {
      ...devices['Desktop Chrome'],
      baseURL: controlPlaneUrl,
    },
  }] : []),
  ...(runWebV2 ? [{
    name: 'web-v2-chromium',
    testMatch: /web-v2\/.*\.spec\.ts/,
    use: {
      ...devices['Desktop Chrome'],
      baseURL: controlPlaneV2Url,
    },
  }] : []),
];

export default defineConfig({
  testDir: './src/__tests__/browser-integration',
  timeout: 30_000,
  workers: 1,
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
  webServer: webServers,
  projects,
});
