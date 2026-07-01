import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import { ToolBundleComposer, type ToolToolkitContext } from '../../../core/tools/index.js';
import { createBrowserResearchToolkit } from '../../../core/tools/toolkits/browser-research/index.js';
import type {
  BrowserDriver,
  BrowserDriverFactory,
  BrowserDriverLaunchOptions,
  BrowserDriverSnapshotOptions,
  BrowserDriverSnapshotResult,
  BrowserDriverTypeOptions,
  NativeChromeConnectionStatus,
  NativeChromeLaunchInput,
  NativeChromeLaunchResult,
} from '../../../core/browser/index.js';
import type { ToolDefinition } from '../../../core/types.js';

describe('createBrowserResearchToolkit', () => {
  it('requires browser_open before snapshot, click, type, or screenshot', async () => {
    const { tools } = await createTools();

    await expect(tools.browser_snapshot.execute({})).resolves.toMatchObject({
      ok: false,
      error: 'browser_snapshot requires browser_open to complete successfully first.',
    });
    await expect(tools.browser_click.execute({ ref: 'el_1' })).resolves.toMatchObject({
      ok: false,
      error: 'browser_click requires browser_open to complete successfully first.',
    });
    await expect(tools.browser_type.execute({ ref: 'el_3', text: 'browser automation' })).resolves.toMatchObject({
      ok: false,
      error: 'browser_type requires browser_open to complete successfully first.',
    });
    await expect(tools.browser_screenshot.execute({})).resolves.toMatchObject({
      ok: false,
      error: 'browser_screenshot requires browser_open to complete successfully first.',
    });
  });

  it('opens an allowlisted page and returns snapshot refs for agent use', async () => {
    const { tools } = await createTools();

    await expect(tools.browser_open.execute({ url: 'https://en.wikipedia.org/wiki/Browser_automation' }))
      .resolves
      .toMatchObject({
        ok: true,
        output: {
          status: 'allowed',
          url: 'https://en.wikipedia.org/wiki/Browser_automation',
        },
      });

    await expect(tools.browser_snapshot.execute({}))
      .resolves
      .toMatchObject({
        ok: true,
        output: {
          title: 'Browser automation',
          ariaSnapshot: '- document "Browser automation"',
          ariaSnapshotLength: 31,
          ariaSnapshotTruncated: false,
          elements: expect.arrayContaining([
            expect.objectContaining({
              ref: 'el_1',
              role: 'link',
              name: 'History',
              href: 'https://en.wikipedia.org/wiki/History',
              rawHref: '/wiki/History',
            }),
            expect.objectContaining({
              ref: 'el_3',
              role: 'searchbox',
              name: 'Search Wikipedia',
              placeholder: 'Search Wikipedia',
              inputType: 'search',
              editable: true,
            }),
          ]),
        },
      });
  });

  it('bounds aria snapshot output for agent-facing browser snapshots', async () => {
    const { tools } = await createTools({
      driver: new FakeBrowserDriver({ ariaSnapshot: 'a'.repeat(13_000) }),
    });

    await tools.browser_open.execute({ url: 'https://en.wikipedia.org/wiki/Browser_automation' });
    await expect(tools.browser_snapshot.execute({}))
      .resolves
      .toMatchObject({
        ok: true,
        output: {
          ariaSnapshot: expect.stringMatching(/\[truncated\]$/),
          ariaSnapshotLength: 13_000,
          ariaSnapshotTruncated: true,
        },
      });
  });

  it('passes the selected profile and display mode into browser driver launch options', async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), 'heddle-browser-toolkit-profile-'));
    const { tools, driverFactory } = await createTools({
      stateRoot,
      profileId: 'personal-login',
      headless: false,
    });

    await expect(tools.browser_open.execute({ url: 'https://en.wikipedia.org/wiki/Browser_automation' }))
      .resolves
      .toMatchObject({ ok: true });

    expect(driverFactory.launchOptions).toMatchObject({
      profile: {
        profileId: 'personal-login',
        userDataDir: join(stateRoot, 'browser-profiles', 'personal-login'),
        headless: false,
      },
    });
  });

  it('passes native Chrome CDP backend settings into browser driver launch options', async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), 'heddle-browser-toolkit-native-cdp-'));
    const { tools, driverFactory } = await createTools({
      stateRoot,
      profileId: 'personal',
      backend: 'native-chrome-cdp',
      cdpEndpoint: 'http://127.0.0.1:9223',
      allowedDomains: ['example.com'],
    });

    await expect(tools.browser_open.execute({ url: 'https://example.com/account/' }))
      .resolves
      .toMatchObject({ ok: true });

    expect(driverFactory.launchOptions).toMatchObject({
      profile: {
        profileId: 'personal',
        backend: 'native-chrome-cdp',
        userDataDir: join(stateRoot, 'native-chrome-profiles', 'personal'),
        cdpEndpoint: 'http://127.0.0.1:9223',
      },
    });
  });

  it('auto-launches native Chrome with the requested browser_open URL before CDP attach', async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), 'heddle-browser-toolkit-native-auto-'));
    const nativeChromeLauncher = new FakeNativeChromeLauncher();
    const { tools, driverFactory } = await createTools({
      stateRoot,
      profileId: 'native-research',
      backend: 'native-chrome-cdp',
      allowedDomains: ['wikipedia.org'],
      nativeChromeLauncher,
      autoLaunchNativeChrome: true,
    });

    await expect(tools.browser_open.execute({ url: 'https://en.wikipedia.org/wiki/Browser_automation' }))
      .resolves
      .toMatchObject({ ok: true });

    expect(nativeChromeLauncher.launchInput).toMatchObject({
      profileId: 'native-research',
      url: 'https://en.wikipedia.org/wiki/Browser_automation',
    });
    expect(driverFactory.launchOptions).toMatchObject({
      profile: {
        backend: 'native-chrome-cdp',
        cdpEndpoint: 'http://127.0.0.1:9223',
      },
    });
  });


  it('blocks off-domain clicks before the driver executes them', async () => {
    const { tools, driver } = await createTools();

    await tools.browser_open.execute({ url: 'https://en.wikipedia.org/wiki/Browser_automation' });
    await tools.browser_snapshot.execute({});
    await expect(tools.browser_click.execute({ ref: 'el_2' }))
      .resolves
      .toMatchObject({
        ok: false,
        error: expect.stringContaining('outside the browser domain allowlist'),
        output: {
          status: 'approvalRequired',
        },
      });

    expect(driver.clickedRefs).toEqual([]);
  });

  it('uses the first opened URL as the browsing boundary when no explicit allowlist is configured', async () => {
    const { tools, driver } = await createTools({ allowedDomains: [] });

    await expect(tools.browser_open.execute({ url: 'https://en.wikipedia.org/wiki/Browser_automation' }))
      .resolves
      .toMatchObject({ ok: true });

    await tools.browser_snapshot.execute({});
    await expect(tools.browser_click.execute({ ref: 'el_2' }))
      .resolves
      .toMatchObject({
        ok: false,
        error: expect.stringContaining('outside the browser domain allowlist'),
        output: {
          status: 'approvalRequired',
        },
      });

    expect(driver.clickedRefs).toEqual([]);
  });

  it('starts a fresh derived browser session when browser_open targets a different domain', async () => {
    const { tools, driver, driverFactory } = await createTools({ allowedDomains: [] });

    await expect(tools.browser_open.execute({ url: 'https://example.com' }))
      .resolves
      .toMatchObject({ ok: true });
    await expect(tools.browser_open.execute({ url: 'https://shopee.tw' }))
      .resolves
      .toMatchObject({
        ok: true,
        output: {
          url: 'https://shopee.tw',
        },
      });

    expect(driver.closedCount).toBe(1);
    expect(driverFactory.launchCount).toBe(2);
    expect(driver.openedUrls).toEqual(['https://example.com', 'https://shopee.tw']);
  });

  it('adopts the final first-open URL when a requested site redirects to a regional domain', async () => {
    const { tools } = await createTools({
      allowedDomains: [],
      driver: new FakeBrowserDriver({
        redirects: {
          'https://shopee.com': 'https://shopee.tw',
        },
      }),
    });

    await expect(tools.browser_open.execute({ url: 'https://shopee.com' }))
      .resolves
      .toMatchObject({
        ok: true,
        output: {
          status: 'allowed',
          url: 'https://shopee.tw',
        },
      });
  });

  it('types into editable snapshot refs and can submit search/navigation', async () => {
    const { tools, driver } = await createTools();

    await tools.browser_open.execute({ url: 'https://en.wikipedia.org/wiki/Browser_automation' });
    await tools.browser_snapshot.execute({});

    await expect(tools.browser_type.execute({
      ref: 'el_3',
      text: 'browser automation history',
      submit: true,
    })).resolves.toMatchObject({
      ok: true,
      output: {
        status: 'allowed',
        url: 'https://en.wikipedia.org/wiki/Special:Search?search=browser+automation+history',
      },
    });

    expect(driver.typedInputs).toEqual([{
      ref: 'el_3',
      text: 'browser automation history',
      clear: true,
      submit: true,
    }]);
    await expect(tools.browser_click.execute({ ref: 'el_1' })).resolves.toMatchObject({
      ok: false,
      error: 'Unknown browser snapshot ref: el_1',
    });
  });

  it('captures screenshots and releases profile locks on close', async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), 'heddle-browser-toolkit-close-'));
    const first = await createTools({ stateRoot });

    await first.tools.browser_open.execute({ url: 'https://en.wikipedia.org/wiki/Browser_automation' });
    await expect(first.tools.browser_screenshot.execute({ name: 'final-page' }))
      .resolves
      .toMatchObject({
        ok: true,
        output: {
          status: 'allowed',
          path: expect.stringContaining('final-page.png'),
        },
      });
    await expect(first.tools.browser_close.execute({})).resolves.toMatchObject({ ok: true });

    const second = await createTools({ stateRoot });
    await expect(second.tools.browser_open.execute({ url: 'https://en.wikipedia.org/wiki/Browser_automation' }))
      .resolves
      .toMatchObject({ ok: true });
    await second.tools.browser_close.execute({});
  });

  it('releases profile locks when browser_open throws after acquiring a session', async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), 'heddle-browser-toolkit-open-throw-'));
    const failing = await createTools({
      stateRoot,
      driver: new ThrowingOpenBrowserDriver(),
    });

    await expect(failing.tools.browser_open.execute({ url: 'https://en.wikipedia.org/wiki/Browser_automation' }))
      .rejects
      .toThrow('driver open failed');

    const fresh = await createTools({ stateRoot });
    await expect(fresh.tools.browser_open.execute({ url: 'https://en.wikipedia.org/wiki/Browser_automation' }))
      .resolves
      .toMatchObject({ ok: true });
    await fresh.tools.browser_close.execute({});
  });

  it('releases profile locks when browser_close throws during driver shutdown', async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), 'heddle-browser-toolkit-close-throw-'));
    const failing = await createTools({
      stateRoot,
      driver: new ThrowingCloseBrowserDriver(),
    });

    await failing.tools.browser_open.execute({ url: 'https://en.wikipedia.org/wiki/Browser_automation' });
    await expect(failing.tools.browser_close.execute({}))
      .rejects
      .toThrow('driver close failed');

    const fresh = await createTools({ stateRoot });
    await expect(fresh.tools.browser_open.execute({ url: 'https://en.wikipedia.org/wiki/Browser_automation' }))
      .resolves
      .toMatchObject({ ok: true });
    await fresh.tools.browser_close.execute({});
  });

  it('composes as an opt-in toolkit without duplicate names', async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), 'heddle-browser-toolkit-compose-'));
    const toolkit = createBrowserResearchToolkit({
      stateRoot,
      allowedDomains: ['wikipedia.org'],
      driverFactory: new FakeBrowserDriverFactory(new FakeBrowserDriver()),
      headless: true,
    });

    const tools = ToolBundleComposer.compose({
      toolkits: [toolkit],
      context: context(stateRoot),
    });

    expect(tools.map((tool) => tool.name)).toEqual([
      'browser_open',
      'browser_snapshot',
      'browser_click',
      'browser_type',
      'browser_screenshot',
      'browser_close',
    ]);
  });
});

async function createTools(options: {
  stateRoot?: string;
  driver?: BrowserDriver;
  allowedDomains?: string[];
  profileId?: string;
  backend?: 'playwright-managed' | 'native-chrome-cdp';
  cdpEndpoint?: string;
  headless?: boolean;
  nativeChromeLauncher?: FakeNativeChromeLauncher;
  autoLaunchNativeChrome?: boolean;
} = {}) {
  const stateRoot = options.stateRoot ?? (await mkdtemp(join(tmpdir(), 'heddle-browser-toolkit-')));
  const driver = options.driver ?? new FakeBrowserDriver();
  const driverFactory = new FakeBrowserDriverFactory(driver);
  const tools = Object.fromEntries(
    createBrowserResearchToolkit({
      stateRoot,
      allowedDomains: options.allowedDomains ?? ['wikipedia.org'],
      driverFactory,
      profileId: options.profileId,
      backend: options.backend,
      cdpEndpoint: options.cdpEndpoint,
      headless: options.headless ?? true,
      nativeChromeLauncher: options.nativeChromeLauncher,
      autoLaunchNativeChrome: options.autoLaunchNativeChrome,
    }).createTools(context(stateRoot)).map((tool) => [tool.name, tool]),
  );

  return {
    driver,
    driverFactory,
    tools: tools as Record<'browser_open' | 'browser_snapshot' | 'browser_click' | 'browser_type' | 'browser_screenshot' | 'browser_close', ToolDefinition>,
  };
}

function context(stateRoot: string): ToolToolkitContext {
  return {
    workspaceRoot: process.cwd(),
    stateRoot,
    artifactRoot: join(stateRoot, 'artifacts'),
    model: 'gpt-5.1-codex-mini',
    memoryDir: join(stateRoot, 'memory'),
    memoryMode: 'none',
  };
}

class FakeBrowserDriverFactory implements BrowserDriverFactory {
  launchOptions?: BrowserDriverLaunchOptions;
  launchCount = 0;

  constructor(private readonly driver: BrowserDriver) {}

  async launch(options: BrowserDriverLaunchOptions): Promise<BrowserDriver> {
    this.launchOptions = options;
    this.launchCount += 1;
    return this.driver;
  }
}

class FakeBrowserDriver implements BrowserDriver {
  clickedRefs: string[] = [];
  typedInputs: Array<{ ref: string; text: string; clear: boolean; submit: boolean }> = [];
  openedUrls: string[] = [];
  closedCount = 0;
  private url = 'about:blank';

  constructor(private readonly options: {
    ariaSnapshot?: string;
    redirects?: Record<string, string>;
  } = {}) {}

  async open(url: string): Promise<string> {
    this.openedUrls.push(url);
    this.url = this.options.redirects?.[url] ?? url;
    return this.url;
  }

  async snapshot(_options: BrowserDriverSnapshotOptions): Promise<BrowserDriverSnapshotResult> {
    return {
      url: this.url,
      title: 'Browser automation',
      ariaSnapshot: this.options.ariaSnapshot ?? '- document "Browser automation"',
      elements: [
        {
          ref: 'el_1',
          role: 'link',
          name: 'History',
          href: 'https://en.wikipedia.org/wiki/History',
          rawHref: '/wiki/History',
          tagName: 'a',
        },
        {
          ref: 'el_2',
          role: 'link',
          name: 'External reference',
          href: 'https://example.com/source',
          rawHref: 'https://example.com/source',
          tagName: 'a',
        },
        {
          ref: 'el_3',
          role: 'searchbox',
          name: 'Search Wikipedia',
          placeholder: 'Search Wikipedia',
          inputType: 'search',
          tagName: 'input',
          editable: true,
        },
      ],
    };
  }

  async click(ref: string): Promise<string> {
    this.clickedRefs.push(ref);
    this.url = 'https://en.wikipedia.org/wiki/History';
    return this.url;
  }

  async type(ref: string, options: BrowserDriverTypeOptions): Promise<string> {
    this.typedInputs.push({
      ref,
      text: options.text,
      clear: options.clear,
      submit: options.submit,
    });
    if (options.submit) {
      this.url = `https://en.wikipedia.org/wiki/Special:Search?search=${options.text.replaceAll(' ', '+')}`;
    }
    return this.url;
  }

  async screenshot(_path: string): Promise<void> {}

  async close(): Promise<void> {
    this.closedCount += 1;
  }

  currentUrl(): string | undefined {
    return this.url;
  }
}

class ThrowingOpenBrowserDriver extends FakeBrowserDriver {
  override async open(_url: string): Promise<string> {
    throw new Error('driver open failed');
  }
}

class ThrowingCloseBrowserDriver extends FakeBrowserDriver {
  override async close(): Promise<void> {
    throw new Error('driver close failed');
  }
}

class FakeNativeChromeLauncher {
  launchInput?: NativeChromeLaunchInput;

  async status(stateRoot: string): Promise<NativeChromeConnectionStatus> {
    return fakeNativeChromeStatus(stateRoot, 'unreachable');
  }

  async launch(stateRoot: string, input: NativeChromeLaunchInput = {}): Promise<NativeChromeLaunchResult> {
    this.launchInput = input;
    return {
      ok: true,
      status: fakeNativeChromeStatus(stateRoot, 'reachable'),
      startUrl: input.url ?? 'https://en.wikipedia.org/wiki/Main_Page',
      reusedExisting: false,
    };
  }
}

function fakeNativeChromeStatus(
  stateRoot: string,
  state: NativeChromeConnectionStatus['state'],
): NativeChromeConnectionStatus {
  return {
    state,
    profileId: 'native-research',
    userDataDir: join(stateRoot, 'native-chrome-profiles', 'native-research'),
    endpoint: 'http://127.0.0.1:9223',
    port: 9223,
    defaultStartUrl: 'https://en.wikipedia.org/wiki/Main_Page',
    checkedAt: '2026-06-16T00:00:00.000Z',
  };
}
