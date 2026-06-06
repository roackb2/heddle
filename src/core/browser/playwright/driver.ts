import { createRequire } from 'node:module';

import type { chromium, BrowserContext, Locator, Page } from 'playwright';

import type {
  BrowserDriver,
  BrowserDriverFactory,
  BrowserDriverLaunchOptions,
  BrowserDriverSnapshotOptions,
  BrowserDriverSnapshotResult,
  BrowserSnapshotElement,
} from '../types.js';

const INTERACTIVE_SELECTOR = [
  'a',
  'button',
  'input',
  'textarea',
  'select',
  'summary',
  '[role]',
  '[tabindex]',
].join(', ');
const nodeRequire = createRequire(import.meta.url);

type PlaywrightChromium = typeof chromium;

/**
 * Playwright-backed browser driver adapter for the validation spike.
 */
export class PlaywrightBrowserDriverFactory implements BrowserDriverFactory {
  async launch(options: BrowserDriverLaunchOptions): Promise<BrowserDriver> {
    const context = await loadPlaywrightChromium().launchPersistentContext(options.profile.userDataDir, {
      acceptDownloads: false,
      channel: options.profile.channel,
      headless: options.profile.headless ?? true,
      viewport: { width: 1280, height: 900 },
    });

    const page = context.pages()[0] ?? await context.newPage();
    return new PlaywrightBrowserDriver(context, page);
  }
}

function loadPlaywrightChromium(): PlaywrightChromium {
  try {
    return (nodeRequire('playwright') as { chromium: PlaywrightChromium }).chromium;
  } catch (error) {
    throw new Error(
      'Browser automation requires the optional playwright package. Install playwright or pass a custom driverFactory to createBrowserResearchToolkit.',
      { cause: error },
    );
  }
}

class PlaywrightBrowserDriver implements BrowserDriver {
  private refs = new Map<string, Locator>();

  constructor(
    private readonly context: BrowserContext,
    private readonly page: Page,
  ) {}

  async open(url: string): Promise<string> {
    await this.page.goto(url, { waitUntil: 'domcontentloaded' });
    return this.page.url();
  }

  async snapshot(options: BrowserDriverSnapshotOptions): Promise<BrowserDriverSnapshotResult> {
    const locator = this.page.locator(INTERACTIVE_SELECTOR);
    const count = Math.min(await locator.count(), options.maxElements);
    const elements: BrowserSnapshotElement[] = [];
    this.refs = new Map<string, Locator>();

    for (let index = 0; index < count; index += 1) {
      const item = locator.nth(index);
      const element = await this.snapshotElement(item, index);
      if (!element) {
        continue;
      }
      elements.push(element);
      this.refs.set(element.ref, item);
    }

    const body = this.page.locator('body');
    const ariaSnapshot = await body.ariaSnapshot().catch(() => '');

    return {
      url: this.page.url(),
      title: await this.page.title(),
      ariaSnapshot,
      elements,
    };
  }

  async click(ref: string): Promise<string> {
    const locator = this.refs.get(ref);
    if (!locator) {
      throw new Error(`Unknown browser snapshot ref: ${ref}`);
    }

    await locator.click();
    await this.page.waitForLoadState('domcontentloaded').catch(() => undefined);
    return this.page.url();
  }

  async screenshot(path: string): Promise<void> {
    await this.page.screenshot({ path, fullPage: true });
  }

  async close(): Promise<void> {
    await this.context.close();
  }

  currentUrl(): string | undefined {
    return this.page.url();
  }

  private async snapshotElement(locator: Locator, index: number): Promise<BrowserSnapshotElement | undefined> {
    const visible = await locator.isVisible().catch(() => false);
    if (!visible) {
      return undefined;
    }

    const detail = await locator.evaluate((element) => {
      const htmlElement = element as HTMLElement;
      const tagName = htmlElement.tagName.toLowerCase();
      const role = htmlElement.getAttribute('role') ?? inferRole(tagName, htmlElement);
      const href = element instanceof HTMLAnchorElement ? element.href : undefined;
      const name = [
        htmlElement.getAttribute('aria-label'),
        htmlElement.getAttribute('title'),
        htmlElement.innerText,
        htmlElement.getAttribute('value'),
        href,
      ].find((value) => value && value.trim())?.trim() ?? tagName;

      return {
        role,
        name,
        text: htmlElement.innerText?.trim() || undefined,
        href,
        tagName,
      };

      function inferRole(tag: string, node: HTMLElement): string {
        const roles: Record<string, string> = {
          a: 'link',
          button: 'button',
          input: inputRole(node),
          select: 'combobox',
          summary: 'button',
          textarea: 'textbox',
        };

        return roles[tag] ?? 'generic';
      }

      function inputRole(node: HTMLElement): string {
        const type = node.getAttribute('type') ?? 'text';
        const roles: Record<string, string> = {
          button: 'button',
          checkbox: 'checkbox',
          radio: 'radio',
          search: 'searchbox',
          submit: 'button',
        };

        return roles[type] ?? 'textbox';
      }
    }).catch(() => undefined);

    if (!detail) {
      return undefined;
    }

    return {
      ref: `el_${index + 1}`,
      ...detail,
    };
  }
}
