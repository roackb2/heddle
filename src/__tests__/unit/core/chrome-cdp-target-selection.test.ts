import { describe, expect, it } from 'vitest';

import { selectChromeCdpTarget } from '../../../core/browser/chrome-cdp/target-selection.js';

describe('selectChromeCdpTarget', () => {
  it('prefers the page matching the expected task URL', () => {
    const selection = selectChromeCdpTarget({
      expectedUrl: 'https://en.wikipedia.org/wiki/Browser_automation',
      targets: [
        { id: '0', url: 'https://example.com/', isCurrent: true },
        { id: '1', url: 'https://en.wikipedia.org/wiki/Browser_automation' },
      ],
    });

    expect(selection).toEqual({
      target: { id: '1', url: 'https://en.wikipedia.org/wiki/Browser_automation' },
      reason: 'expected-url',
    });
  });

  it('prefers a same-origin page over a stale verification page after manual unblock', () => {
    const selection = selectChromeCdpTarget({
      expectedUrl: 'https://shopee.tw/',
      targets: [
        { id: '0', url: 'https://shopee.tw/verify/captcha?anti_bot_tracking_id=abc', isCurrent: true },
        { id: '1', url: 'https://shopee.tw/' },
      ],
    });

    expect(selection).toEqual({
      target: { id: '1', url: 'https://shopee.tw/' },
      reason: 'expected-url',
    });
  });

  it('keeps the current same-origin page when there is no better page', () => {
    const selection = selectChromeCdpTarget({
      expectedUrl: 'https://shop.example/search',
      targets: [
        { id: '0', url: 'https://shop.example/search?q=heels', isCurrent: true },
        { id: '1', url: 'https://other.example/' },
      ],
    });

    expect(selection).toEqual({
      target: { id: '0', url: 'https://shop.example/search?q=heels', isCurrent: true },
      reason: 'same-origin',
    });
  });

  it('ignores internal Chrome and extension pages', () => {
    const selection = selectChromeCdpTarget({
      expectedUrl: 'https://example.com/',
      targets: [
        { id: '0', url: 'chrome://new-tab-page/', isCurrent: true },
        { id: '1', url: 'chrome-extension://extension-id/popup.html' },
        { id: '2', url: 'https://example.com/' },
      ],
    });

    expect(selection).toEqual({
      target: { id: '2', url: 'https://example.com/' },
      reason: 'expected-url',
    });
  });
});
