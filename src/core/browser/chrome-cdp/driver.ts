import { createRequire } from 'node:module';

import type { chromium, Browser, BrowserContext, Locator, Page } from 'playwright';

import type {
  BrowserDriver,
  BrowserDriverClickOptions,
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
 * Experimental adapter that attaches to a user-launched native Chrome CDP endpoint.
 *
 * This backend must not launch or own the Chrome process. Closing the driver only
 * detaches Heddle from the CDP connection.
 */
export class ChromeCdpBrowserDriverFactory implements BrowserDriverFactory {
  async launch(options: BrowserDriverLaunchOptions): Promise<BrowserDriver> {
    if (!options.profile.cdpEndpoint) {
      throw new Error('Native Chrome CDP browser backend requires a cdpEndpoint such as http://127.0.0.1:9222.');
    }

    const browser = await loadPlaywrightChromium().connectOverCDP(options.profile.cdpEndpoint);
    const context = browser.contexts()[0] ?? await browser.newContext();
    const page = context.pages()[0] ?? await context.newPage();
    return new ChromeCdpBrowserDriver(browser, context, page);
  }
}

function loadPlaywrightChromium(): PlaywrightChromium {
  try {
    return (nodeRequire('playwright') as { chromium: PlaywrightChromium }).chromium;
  } catch (error) {
    throw new Error(
      'Native Chrome CDP attach currently requires the optional playwright package for connectOverCDP.',
      { cause: error },
    );
  }
}

class ChromeCdpBrowserDriver implements BrowserDriver {
  private refs = new Map<string, Locator>();

  constructor(
    private readonly browser: Browser,
    private readonly context: BrowserContext,
    private readonly page: Page,
  ) {}

  async open(url: string): Promise<string> {
    await this.page.goto(url, { waitUntil: 'domcontentloaded' });
    return this.page.url();
  }

  async snapshot(options: BrowserDriverSnapshotOptions): Promise<BrowserDriverSnapshotResult> {
    const locator = this.page.locator(INTERACTIVE_SELECTOR);
    const count = await locator.count();
    const elements: BrowserSnapshotElement[] = [];
    this.refs = new Map<string, Locator>();

    for (let index = 0; index < count && elements.length < options.maxElements; index += 1) {
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

  async click(_ref: string, _options: BrowserDriverClickOptions = {}): Promise<string> {
    throw new Error('Native Chrome CDP click is disabled until it preserves Heddle navigation-policy parity.');
  }

  async screenshot(path: string): Promise<void> {
    await this.page.screenshot({ path, fullPage: true });
  }

  async close(): Promise<void> {
    await this.browser.close({ reason: 'Heddle detached from native Chrome CDP session.' });
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
      const rawHref = element instanceof HTMLAnchorElement
        ? htmlElement.getAttribute('href') ?? undefined
        : undefined;
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
        rawHref,
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
