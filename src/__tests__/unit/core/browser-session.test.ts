import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import {
  BrowserSessionService,
  type BrowserActionEvidenceEvent,
  type BrowserDriver,
  type BrowserDriverClickOptions,
  type BrowserDriverFactory,
  type BrowserDriverLaunchOptions,
  type BrowserDriverSnapshotOptions,
  type BrowserDriverSnapshotResult,
} from '../../../core/browser/index.js';

describe('BrowserSessionService', () => {
  it('opens, snapshots, clicks, screenshots, and records evidence through the browser domain', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'heddle-browser-session-'));
    const driver = new FakeBrowserDriver();
    const session = new BrowserSessionService({
      profile: {
        profileId: 'test',
        userDataDir: join(dir, 'profile'),
        headless: true,
      },
      policy: {
        allowedDomains: ['wikipedia.org'],
      },
      evidenceDir: join(dir, 'run'),
    }, new FakeBrowserDriverFactory(driver));

    const open = await session.open({ url: 'https://en.wikipedia.org/wiki/Browser_automation' });
    expect(open.status).toBe('allowed');

    const snapshot = await session.snapshot();
    expect(snapshot.data?.elements).toEqual(expect.arrayContaining([
      expect.objectContaining({ ref: 'el_1', name: 'History' }),
      expect.objectContaining({ ref: 'el_2', name: 'Checkout' }),
    ]));

    const click = await session.click({ ref: 'el_1' });
    expect(click).toMatchObject({
      status: 'allowed',
      data: { finalUrl: 'https://en.wikipedia.org/wiki/History' },
    });

    const screenshot = await session.screenshot({ name: 'after-click' });
    expect(screenshot.data?.path.endsWith('after-click.png')).toBe(true);

    await session.close();

    const events = await readFile(join(dir, 'run', 'events.jsonl'), 'utf8');
    const parsedEvents = parseEvidenceEvents(events);
    expect(parsedEvents.map((event) => event.action)).toEqual([
      'open',
      'snapshot',
      'click',
      'screenshot',
      'close',
    ]);
    expect(parsedEvents.find((event) => event.action === 'click')).toMatchObject({
      detail: {
        target: {
          ref: 'el_1',
          role: 'link',
          name: 'History',
          href: 'https://en.wikipedia.org/wiki/History',
        },
      },
    });
    expect(parsedEvents.find((event) => event.action === 'screenshot')).toMatchObject({
      detail: {
        path: expect.stringContaining('after-click.png'),
      },
    });
  });

  it('revokes snapshot refs after a click changes the page', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'heddle-browser-session-revoke-refs-'));
    const driver = new FakeBrowserDriver();
    const session = new BrowserSessionService({
      profile: {
        profileId: 'test',
        userDataDir: join(dir, 'profile'),
        headless: true,
      },
      policy: {
        allowedDomains: ['wikipedia.org'],
      },
      evidenceDir: join(dir, 'run'),
    }, new FakeBrowserDriverFactory(driver));

    await session.open({ url: 'https://en.wikipedia.org/wiki/Browser_automation' });
    await session.snapshot();
    await expect(session.click({ ref: 'el_1' })).resolves.toMatchObject({ status: 'allowed' });

    await expect(session.click({ ref: 'el_1' })).resolves.toMatchObject({
      status: 'blocked',
      reason: 'Unknown browser snapshot ref: el_1',
    });
    expect(driver.clickedRefs).toEqual(['el_1']);
  });

  it('blocks forbidden click refs before the driver executes them', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'heddle-browser-session-block-'));
    const driver = new FakeBrowserDriver();
    const session = new BrowserSessionService({
      profile: {
        profileId: 'test',
        userDataDir: join(dir, 'profile'),
        headless: true,
      },
      policy: {
        allowedDomains: ['wikipedia.org'],
      },
      evidenceDir: join(dir, 'run'),
    }, new FakeBrowserDriverFactory(driver));

    await session.open({ url: 'https://en.wikipedia.org/wiki/Browser_automation' });
    await session.snapshot();
    const result = await session.click({ ref: 'el_2' });

    expect(result).toMatchObject({
      status: 'blocked',
      reason: expect.stringContaining('forbidden browser action text'),
    });
    expect(driver.clickedRefs).toEqual([]);
  });

  it('blocks stale snapshot refs before the driver executes them', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'heddle-browser-session-stale-'));
    const driver = new FakeBrowserDriver();
    const session = new BrowserSessionService({
      profile: {
        profileId: 'test',
        userDataDir: join(dir, 'profile'),
        headless: true,
      },
      policy: {
        allowedDomains: ['wikipedia.org'],
      },
      evidenceDir: join(dir, 'run'),
    }, new FakeBrowserDriverFactory(driver));

    await session.open({ url: 'https://en.wikipedia.org/wiki/Browser_automation' });
    await session.snapshot();
    const result = await session.click({ ref: 'missing_ref' });

    expect(result).toMatchObject({
      status: 'blocked',
      reason: 'Unknown browser snapshot ref: missing_ref',
    });
    expect(driver.clickedRefs).toEqual([]);
  });

  it('requires approval for off-domain click refs before the driver executes them', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'heddle-browser-session-off-domain-'));
    const driver = new FakeBrowserDriver();
    const session = new BrowserSessionService({
      profile: {
        profileId: 'test',
        userDataDir: join(dir, 'profile'),
        headless: true,
      },
      policy: {
        allowedDomains: ['wikipedia.org'],
      },
      evidenceDir: join(dir, 'run'),
    }, new FakeBrowserDriverFactory(driver));

    await session.open({ url: 'https://en.wikipedia.org/wiki/Browser_automation' });
    await session.snapshot();
    const result = await session.click({ ref: 'el_3' });

    expect(result).toMatchObject({
      status: 'approvalRequired',
      reason: expect.stringContaining('outside the browser domain allowlist'),
    });
    expect(driver.clickedRefs).toEqual([]);
  });

  it('requires approval for click refs without known destinations before the driver executes them', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'heddle-browser-session-unknown-click-'));
    const driver = new FakeBrowserDriver();
    const session = new BrowserSessionService({
      profile: {
        profileId: 'test',
        userDataDir: join(dir, 'profile'),
        headless: true,
      },
      policy: {
        allowedDomains: ['wikipedia.org'],
      },
      evidenceDir: join(dir, 'run'),
    }, new FakeBrowserDriverFactory(driver));

    await session.open({ url: 'https://en.wikipedia.org/wiki/Browser_automation' });
    await session.snapshot();
    const result = await session.click({ ref: 'el_4' });

    expect(result).toMatchObject({
      status: 'approvalRequired',
      reason: expect.stringContaining('does not expose a browser navigation URL'),
    });
    expect(driver.clickedRefs).toEqual([]);
  });

  it('blocks off-domain navigation triggered by an allowlisted click ref', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'heddle-browser-session-redirect-'));
    const driver = new FakeBrowserDriver();
    const session = new BrowserSessionService({
      profile: {
        profileId: 'test',
        userDataDir: join(dir, 'profile'),
        headless: true,
      },
      policy: {
        allowedDomains: ['wikipedia.org'],
      },
      evidenceDir: join(dir, 'run'),
    }, new FakeBrowserDriverFactory(driver));

    await session.open({ url: 'https://en.wikipedia.org/wiki/Browser_automation' });
    await session.snapshot();
    const result = await session.click({ ref: 'el_5' });

    expect(result).toMatchObject({
      status: 'approvalRequired',
      url: 'https://example.com/redirect',
      reason: expect.stringContaining('outside the browser domain allowlist'),
    });
    expect(driver.clickedRefs).toEqual([]);
    expect(driver.currentUrl()).toBe('https://en.wikipedia.org/wiki/Browser_automation');
  });

  it('passes the snapshot max element cap to the browser driver', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'heddle-browser-session-cap-'));
    const driver = new FakeBrowserDriver();
    const session = new BrowserSessionService({
      profile: {
        profileId: 'test',
        userDataDir: join(dir, 'profile'),
        headless: true,
      },
      policy: {
        allowedDomains: ['wikipedia.org'],
        maxElementsPerSnapshot: 2,
      },
      evidenceDir: join(dir, 'run'),
    }, new FakeBrowserDriverFactory(driver));

    await session.open({ url: 'https://en.wikipedia.org/wiki/Browser_automation' });
    await session.snapshot();

    expect(driver.snapshotOptions).toEqual([{ maxElements: 2 }]);
  });
});

class FakeBrowserDriverFactory implements BrowserDriverFactory {
  constructor(private readonly driver: BrowserDriver) {}

  async launch(_options: BrowserDriverLaunchOptions): Promise<BrowserDriver> {
    return this.driver;
  }
}

class FakeBrowserDriver implements BrowserDriver {
  clickedRefs: string[] = [];
  snapshotOptions: BrowserDriverSnapshotOptions[] = [];
  private url = 'about:blank';

  async open(url: string): Promise<string> {
    this.url = url;
    return this.url;
  }

  async snapshot(options: BrowserDriverSnapshotOptions): Promise<BrowserDriverSnapshotResult> {
    this.snapshotOptions.push(options);
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
          role: 'button',
          name: 'Checkout',
          text: 'Checkout',
          tagName: 'button',
        },
        {
          ref: 'el_3',
          role: 'link',
          name: 'External reference',
          href: 'https://example.com/source',
          tagName: 'a',
        },
        {
          ref: 'el_4',
          role: 'button',
          name: 'Open menu',
          text: 'Open menu',
          tagName: 'button',
        },
        {
          ref: 'el_5',
          role: 'link',
          name: 'Safe redirect',
          href: 'https://en.wikipedia.org/wiki/Safe_redirect',
          tagName: 'a',
        },
      ],
    };
  }

  async click(ref: string, options: BrowserDriverClickOptions = {}): Promise<string> {
    const nextUrl = ref === 'el_5' ? 'https://example.com/redirect' : 'https://en.wikipedia.org/wiki/History';
    if (!(options.canNavigateTo?.(nextUrl) ?? true)) {
      throw new Error('navigation blocked by browser guard');
    }

    this.clickedRefs.push(ref);
    this.url = nextUrl;
    return this.url;
  }

  async screenshot(_path: string): Promise<void> {}

  async close(): Promise<void> {}

  currentUrl(): string | undefined {
    return this.url;
  }
}

function parseEvidenceEvents(events: string): BrowserActionEvidenceEvent[] {
  return events
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as BrowserActionEvidenceEvent);
}
