import { createServer } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  BrowserProfileSettingsService,
  DEFAULT_NATIVE_CHROME_START_URL,
  NativeChromeProfileService,
} from '@/core/browser/index.js';

describe('NativeChromeProfileService', () => {
  const servers: ReturnType<typeof createServer>[] = [];

  afterEach(async () => {
    await Promise.all(servers.map((server) => new Promise<void>((resolve) => {
      server.close(() => resolve());
    })));
    servers.length = 0;
  });

  it('uses Wikipedia as the meaningful default launch URL', async () => {
    const root = await mkdtemp(join(tmpdir(), 'heddle-native-chrome-url-'));
    const result = await NativeChromeProfileService.launch(join(root, '.heddle'), {
      profileId: '../bad',
    });

    expect(result).toMatchObject({
      ok: false,
      startUrl: DEFAULT_NATIVE_CHROME_START_URL,
      error: expect.stringContaining('Profile id must start'),
    });
  });

  it('reuses an already reachable local CDP endpoint and records native settings', async () => {
    const root = await mkdtemp(join(tmpdir(), 'heddle-native-chrome-reuse-'));
    const stateRoot = join(root, '.heddle');
    const { endpoint } = await startCdpVersionServer();

    await expect(NativeChromeProfileService.launch(stateRoot, {
      profileId: 'shopping',
      url: 'https://www.wikipedia.org/',
      port: Number(new URL(endpoint).port),
    })).resolves.toMatchObject({
      ok: true,
      reusedExisting: true,
      status: {
        state: 'reachable',
        endpoint,
        profileId: 'shopping',
        browser: 'Chrome/137.0.0.0',
      },
    });
    expect(BrowserProfileSettingsService.toolkitOptions(stateRoot)).toMatchObject({
      backend: 'native-chrome-cdp',
      cdpEndpoint: endpoint,
      profileId: 'shopping',
    });
  });

  function startCdpVersionServer(): Promise<{ endpoint: string }> {
    const server = createServer((request, response) => {
      if (request.url !== '/json/version') {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        Browser: 'Chrome/137.0.0.0',
        webSocketDebuggerUrl: 'ws://127.0.0.1/devtools/browser/test',
      }));
    });
    servers.push(server);

    return new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (typeof address !== 'object' || !address) {
          throw new Error('Expected HTTP server address.');
        }
        resolve({ endpoint: `http://127.0.0.1:${address.port}` });
      });
    });
  }
});
