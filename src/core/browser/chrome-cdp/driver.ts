import { createRequire } from 'node:module';

import type { chromium, Browser, BrowserContext, Locator, Page, Route } from 'playwright';

import type {
  BrowserDriver,
  BrowserDriverClickOptions,
  BrowserDriverFactory,
  BrowserDriverLaunchOptions,
  BrowserDriverSnapshotOptions,
  BrowserDriverSnapshotResult,
  BrowserDriverTypeOptions,
  BrowserSnapshotElement,
} from '../types.js';
import { selectChromeCdpTarget } from './target-selection.js';

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
  private expectedUrl: string | undefined;

  constructor(
    private readonly browser: Browser,
    private readonly context: BrowserContext,
    private page: Page,
  ) {}

  async open(url: string): Promise<string> {
    this.expectedUrl = url;
    await this.reconcilePage();
    await this.page.goto(url, { waitUntil: 'domcontentloaded' });
    await this.page.bringToFront().catch(() => undefined);
    this.expectedUrl = this.page.url();
    return this.expectedUrl;
  }

  async snapshot(options: BrowserDriverSnapshotOptions): Promise<BrowserDriverSnapshotResult> {
    await this.reconcilePage();
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

  async click(ref: string, options: BrowserDriverClickOptions = {}): Promise<string> {
    await this.reconcilePage();
    const locator = this.refs.get(ref);
    if (!locator) {
      throw new Error(`Unknown browser snapshot ref: ${ref}`);
    }

    await this.runWithNavigationGuard(options, async () => {
      await locator.click();
    });
    this.expectedUrl = this.page.url();
    return this.expectedUrl;
  }

  async type(ref: string, options: BrowserDriverTypeOptions): Promise<string> {
    await this.reconcilePage();
    const locator = this.refs.get(ref);
    if (!locator) {
      throw new Error(`Unknown browser snapshot ref: ${ref}`);
    }

    await this.runWithNavigationGuard(options, async () => {
      if (options.clear) {
        await locator.fill(options.text);
      } else {
        await locator.click();
        await locator.type(options.text);
      }

      if (options.submit) {
        await locator.press('Enter');
      }
    });
    this.expectedUrl = this.page.url();
    return this.expectedUrl;
  }

  private async runWithNavigationGuard(
    options: BrowserDriverClickOptions,
    action: () => Promise<void>,
  ): Promise<void> {
    const routeHandler = this.createNavigationGuard(options);
    await this.page.route('**/*', routeHandler);
    try {
      await action();
      await this.page.waitForLoadState('domcontentloaded').catch(() => undefined);
    } finally {
      await this.page.unroute('**/*', routeHandler).catch(() => undefined);
    }
  }

  private createNavigationGuard(options: BrowserDriverClickOptions): (route: Route) => Promise<void> {
    return async (route) => {
      const request = route.request();
      if (!request.isNavigationRequest() || !options.canNavigateTo) {
        await route.continue();
        return;
      }

      if (!options.canNavigateTo(request.url())) {
        await route.abort('blockedbyclient');
        return;
      }

      const finalUrl = await this.resolveFinalNavigationUrl(route);
      if (!options.canNavigateTo(finalUrl)) {
        await route.abort('blockedbyclient');
        return;
      }

      await route.continue();
    };
  }

  private async resolveFinalNavigationUrl(route: Route): Promise<string> {
    const response = await route.fetch({ maxRedirects: 20 });
    return response.url();
  }

  async screenshot(path: string): Promise<void> {
    await this.reconcilePage();
    await this.page.screenshot({ path, fullPage: true });
  }

  async close(): Promise<void> {
    await this.browser.close({ reason: 'Heddle detached from native Chrome CDP session.' });
  }

  currentUrl(): string | undefined {
    return this.page.url();
  }

  private async reconcilePage(): Promise<void> {
    const pages = this.context.pages().filter((page) => !page.isClosed());
    const selection = selectChromeCdpTarget({
      expectedUrl: this.expectedUrl ?? this.page.url(),
      targets: pages.map((page, index) => ({
        id: String(index),
        url: page.url(),
        isCurrent: page === this.page,
      })),
    });
    const selectedPage = selection ? pages[Number(selection.target.id)] : undefined;

    if (!selectedPage || selectedPage === this.page) {
      return;
    }

    this.page = selectedPage;
    this.refs = new Map<string, Locator>();
    await this.page.bringToFront().catch(() => undefined);
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
      const inputType = element instanceof HTMLInputElement
        ? element.type
        : undefined;
      const placeholder = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
        ? element.placeholder || undefined
        : undefined;
      const disabled = element instanceof HTMLButtonElement
        || element instanceof HTMLInputElement
        || element instanceof HTMLSelectElement
        || element instanceof HTMLTextAreaElement
          ? element.disabled
          : undefined;
      const readonly = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
        ? element.readOnly
        : undefined;
      const editable = isEditableElement(htmlElement);
      const rawHref = element instanceof HTMLAnchorElement
        ? htmlElement.getAttribute('href') ?? undefined
        : undefined;
      const name = [
        htmlElement.getAttribute('aria-label'),
        htmlElement.getAttribute('title'),
        placeholder,
        htmlElement.innerText,
        href,
      ].find((value) => value && value.trim())?.trim() ?? tagName;

      return {
        role,
        name,
        text: htmlElement.innerText?.trim() || undefined,
        href,
        rawHref,
        tagName,
        inputType,
        placeholder,
        disabled,
        readonly,
        editable,
      };

      function isEditableElement(node: HTMLElement): boolean {
        return node.isContentEditable
          || node instanceof HTMLInputElement
          || node instanceof HTMLTextAreaElement
          || node.getAttribute('role') === 'textbox'
          || node.getAttribute('role') === 'searchbox';
      }

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
