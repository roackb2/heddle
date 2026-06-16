import { ChromeCdpBrowserDriverFactory } from '../chrome-cdp/index.js';
import { PlaywrightBrowserDriverFactory } from '../playwright/index.js';
import type { BrowserBackendSelection, BrowserDriverFactory } from '../types.js';

/**
 * Resolves browser backend implementations at the browser-domain boundary.
 */
export class BrowserDriverFactoryService {
  static resolve(backend: BrowserBackendSelection = 'playwright-managed'): BrowserDriverFactory {
    return backend === 'native-chrome-cdp'
      ? new ChromeCdpBrowserDriverFactory()
      : new PlaywrightBrowserDriverFactory();
  }
}
