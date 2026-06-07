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
} = {}) {
  const stateRoot = options.stateRoot ?? (await mkdtemp(join(tmpdir(), 'heddle-browser-toolkit-')));
  const driver = options.driver ?? new FakeBrowserDriver();
  const tools = Object.fromEntries(
    createBrowserResearchToolkit({
      stateRoot,
      allowedDomains: ['wikipedia.org'],
      driverFactory: new FakeBrowserDriverFactory(driver),
      headless: true,
    }).createTools(context(stateRoot)).map((tool) => [tool.name, tool]),
  );

  return {
    driver,
    tools: tools as Record<'browser_open' | 'browser_snapshot' | 'browser_click' | 'browser_screenshot' | 'browser_close', ToolDefinition>,
  };
}

function context(stateRoot: string): ToolToolkitContext {
  return {
    workspaceRoot: process.cwd(),
    model: 'gpt-5.1-codex-mini',
    memoryDir: join(stateRoot, 'memory'),
    memoryMode: 'none',
  };
}

class FakeBrowserDriverFactory implements BrowserDriverFactory {
  constructor(private readonly driver: BrowserDriver) {}

  async launch(_options: BrowserDriverLaunchOptions): Promise<BrowserDriver> {
    return this.driver;
  }
}

class FakeBrowserDriver implements BrowserDriver {
  clickedRefs: string[] = [];
  private url = 'about:blank';

  async open(url: string): Promise<string> {
    this.url = url;
    return this.url;
  }

  async snapshot(_options: BrowserDriverSnapshotOptions): Promise<BrowserDriverSnapshotResult> {
    return {
      url: this.url,
      title: 'Browser automation',
      ariaSnapshot: '- document "Browser automation"',
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
