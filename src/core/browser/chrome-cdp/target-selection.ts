import maxBy from 'lodash/maxBy.js';

export interface ChromeCdpPageTarget {
  id: string;
  url: string;
  isCurrent?: boolean;
}

export interface ChromeCdpTargetSelectionInput {
  targets: ChromeCdpPageTarget[];
  expectedUrl?: string;
}

export interface ChromeCdpTargetSelection {
  target: ChromeCdpPageTarget;
  reason: 'expected-url' | 'same-origin' | 'same-host' | 'current' | 'best-browser-page';
}

/**
 * Selects the Chrome target Heddle should inspect or control next.
 *
 * Native Chrome users may solve login challenges or CAPTCHA in the visible
 * browser window while Heddle is attached through CDP. Chrome can expose that
 * as a different page target than the one selected during initial attach, so
 * this module owns target reconciliation for the CDP backend.
 */
export function selectChromeCdpTarget(
  input: ChromeCdpTargetSelectionInput,
): ChromeCdpTargetSelection | undefined {
  const scoredTargets = input.targets
    .filter((target) => isInspectableBrowserUrl(target.url))
    .map((target, index) => ({
      target,
      index,
      score: scoreTarget(target, input.expectedUrl) + index,
      reason: reasonForTarget(target, input.expectedUrl),
    }));

  const selected = maxBy(scoredTargets, ({ score }) => score);
  if (!selected) {
    return undefined;
  }

  return {
    target: selected.target,
    reason: selected.reason,
  };
}

function scoreTarget(target: ChromeCdpPageTarget, expectedUrl?: string): number {
  const expected = parseUrl(expectedUrl);
  const current = parseUrl(target.url);
  const challengePenalty = isChallengeUrl(target.url) ? -40 : 0;
  const currentBias = target.isCurrent ? 20 : 0;

  if (expected && current) {
    if (normalizeHref(current.href) === normalizeHref(expected.href)) {
      return 1_000 + currentBias + challengePenalty;
    }

    if (current.origin === expected.origin) {
      return 800 + currentBias + challengePenalty;
    }

    if (current.hostname === expected.hostname) {
      return 700 + currentBias + challengePenalty;
    }

    return 100 + currentBias + challengePenalty;
  }

  return 200 + currentBias + challengePenalty;
}

function reasonForTarget(
  target: ChromeCdpPageTarget,
  expectedUrl?: string,
): ChromeCdpTargetSelection['reason'] {
  const expected = parseUrl(expectedUrl);
  const current = parseUrl(target.url);

  if (expected && current) {
    if (normalizeHref(current.href) === normalizeHref(expected.href)) {
      return 'expected-url';
    }

    if (current.origin === expected.origin) {
      return 'same-origin';
    }

    if (current.hostname === expected.hostname) {
      return 'same-host';
    }
  }

  return target.isCurrent ? 'current' : 'best-browser-page';
}

function isInspectableBrowserUrl(url: string): boolean {
  const parsed = parseUrl(url);
  if (!parsed) {
    return false;
  }

  return ![
    'about:',
    'chrome:',
    'chrome-extension:',
    'devtools:',
    'edge:',
  ].includes(parsed.protocol);
}

function isChallengeUrl(url: string): boolean {
  return /(?:captcha|challenge|anti[-_]?bot|bot[-_]?check|verify\/captcha)/i.test(url);
}

function normalizeHref(href: string): string {
  return href.endsWith('/') ? href.slice(0, -1) : href;
}

function parseUrl(url?: string): URL | undefined {
  if (!url) {
    return undefined;
  }

  try {
    return new URL(url);
  } catch {
    return undefined;
  }
}
