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
} from '../../../core/browser/index.js';
import type { ToolDefinition } from '../../../core/types.js';

describe('createBrowserResearchToolkit', () => {
  it('requires browser_open before snapshot, click, or screenshot', async () => {
    const { tools } = await createTools();

    await expect(tools.browser_snapshot.execute({})).resolves.toMatchObject({
      ok: false,
      error: 'browser_snapshot requires browser_open to complete successfully first.',
    });
    await expect(tools.browser_click.execute({ ref: 'el_1' })).resolves.toMatchObject({
      ok: false,
      error: 'browser_click requires browser_open to complete successfully first.',
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
          elements: expect.arrayContaining([
            expect.objectContaining({
              ref: 'el_1',
              role: 'link',
              name: 'History',
            }),
          ]),
        },
      });
  });

  it('bounds aria snapshot output for agent-facing browser snapshots', async () => {
    const { tools } = await createTools({
      driver: new FakeBrowserDriver({ ariaSnapshot: 'a'.repeat(7000) }),
    });

    await tools.browser_open.execute({ url: 'https://en.wikipedia.org/wiki/Browser_automation' });
    await expect(tools.browser_snapshot.execute({}))
      .resolves
      .toMatchObject({
        ok: true,
        output: {
          ariaSnapshot: expect.stringMatching(/\[truncated\]$/),
        },
      });
  });

  it('passes the selected profile and display mode into browser driver launch options', async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), 'heddle-browser-toolkit-profile-'));
    const { tools, driverFactory } = await createTools({
      stateRoot,
      profileId: 'airspace-login',
      headless: false,
    });

    await expect(tools.browser_open.execute({ url: 'https://en.wikipedia.org/wiki/Browser_automation' }))
      .resolves
      .toMatchObject({ ok: true });

    expect(driverFactory.launchOptions).toMatchObject({
      profile: {
        profileId: 'airspace-login',
        userDataDir: join(stateRoot, 'browser-profiles', 'airspace-login'),
        headless: false,
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
  headless?: boolean;
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
      headless: options.headless ?? true,
    }).createTools(context(stateRoot)).map((tool) => [tool.name, tool]),
  );

  return {
    driver,
    driverFactory,
    tools: tools as Record<'browser_open' | 'browser_snapshot' | 'browser_click' | 'browser_screenshot' | 'browser_close', ToolDefinition>,
  };
}

function context(stateRoot: string): ToolToolkitContext {
  return {
    workspaceRoot: process.cwd(),
    stateRoot,
    model: 'gpt-5.1-codex-mini',
    memoryDir: join(stateRoot, 'memory'),
    memoryMode: 'none',
  };
}

class FakeBrowserDriverFactory implements BrowserDriverFactory {
  launchOptions?: BrowserDriverLaunchOptions;

  constructor(private readonly driver: BrowserDriver) {}

  async launch(options: BrowserDriverLaunchOptions): Promise<BrowserDriver> {
    this.launchOptions = options;
    return this.driver;
  }
}

class FakeBrowserDriver implements BrowserDriver {
  clickedRefs: string[] = [];
  private url = 'about:blank';

  constructor(private readonly options: { ariaSnapshot?: string } = {}) {}

  async open(url: string): Promise<string> {
    this.url = url;
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
          tagName: 'a',
        },
        {
          ref: 'el_2',
          role: 'link',
          name: 'External reference',
          href: 'https://example.com/source',
          tagName: 'a',
        },
      ],
    };
  }

  async click(ref: string): Promise<string> {
    this.clickedRefs.push(ref);
    this.url = 'https://en.wikipedia.org/wiki/History';
    return this.url;
  }

  async screenshot(_path: string): Promise<void> {}

  async close(): Promise<void> {}

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
