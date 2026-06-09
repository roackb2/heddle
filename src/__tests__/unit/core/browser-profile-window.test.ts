import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  BrowserProfileSettingsService,
  BrowserProfileWindowService,
  type BrowserDriver,
  type BrowserDriverFactory,
  type BrowserDriverLaunchOptions,
  type BrowserDriverSnapshotOptions,
  type BrowserDriverSnapshotResult,
} from '../../../core/browser/index.js';

describe('BrowserProfileWindowService', () => {
  it('opens the selected profile in headed mode and closes it cleanly', async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), 'heddle-browser-profile-window-'));
    await BrowserProfileSettingsService.update(stateRoot, {
      profileId: 'shopping-login',
      headless: true,
    });
    const driverFactory = new FakeBrowserDriverFactory();

    await expect(BrowserProfileWindowService.open(stateRoot, {
      driverFactory,
      url: 'https://example.com/login',
    })).resolves.toMatchObject({
      ok: true,
      status: {
        profileId: 'shopping-login',
        open: true,
        currentUrl: 'https://example.com/login',
      },
    });
    expect(driverFactory.launchOptions).toMatchObject({
      profile: {
        profileId: 'shopping-login',
        headless: false,
        userDataDir: join(stateRoot, 'browser-profiles', 'shopping-login'),
      },
    });

    await expect(BrowserProfileWindowService.close(stateRoot)).resolves.toMatchObject({
      ok: true,
      status: {
        profileId: 'shopping-login',
        open: false,
      },
    });
  });

  it('rejects invalid start URLs before launching a profile window', async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), 'heddle-browser-profile-window-url-'));
    const driverFactory = new FakeBrowserDriverFactory();

    await expect(BrowserProfileWindowService.open(stateRoot, {
      driverFactory,
      url: 'file:///Users/roackb2/private',
    })).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining('http or https'),
    });
    expect(driverFactory.launchOptions).toBeUndefined();
  });
});

class FakeBrowserDriverFactory implements BrowserDriverFactory {
  launchOptions?: BrowserDriverLaunchOptions;

  async launch(options: BrowserDriverLaunchOptions): Promise<BrowserDriver> {
    this.launchOptions = options;
    return new FakeBrowserDriver();
  }
}

class FakeBrowserDriver implements BrowserDriver {
  private url = 'about:blank';

  async open(url: string): Promise<string> {
    this.url = url;
    return this.url;
  }

  async snapshot(_options: BrowserDriverSnapshotOptions): Promise<BrowserDriverSnapshotResult> {
    return {
      url: this.url,
      title: 'Profile window',
      ariaSnapshot: '',
      elements: [],
    };
  }

  async click(_ref: string): Promise<string> {
    return this.url;
  }

  async screenshot(_path: string): Promise<void> {}

  async close(): Promise<void> {}

  currentUrl(): string | undefined {
    return this.url;
  }
}
