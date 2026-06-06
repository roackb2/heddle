import type { BrowserPolicyConfig, BrowserPolicyDecision, BrowserSnapshotElement } from '../types.js';

export const DEFAULT_FORBIDDEN_BROWSER_ACTION_TEXT = [
  'checkout',
  'check out',
  'pay',
  'payment',
  'place order',
  'confirm',
  'bid',
  'subscribe',
  'book',
  'send',
  'transfer',
  'delete',
  'remove account',
  'add to cart',
  'buy now',
];

/**
 * Owns browser navigation and action policy decisions.
 */
export class BrowserPolicyService {
  constructor(private readonly config: BrowserPolicyConfig) {}

  evaluateNavigation(url: string): BrowserPolicyDecision {
    const hostname = this.hostnameFromUrl(url);
    if (!hostname) {
      return {
        status: 'blocked',
        risk: 'medium',
        reason: `Invalid browser navigation URL: ${url}`,
      };
    }

    if (this.isAllowedHostname(hostname)) {
      return { status: 'allowed', risk: 'low' };
    }

    return this.config.requireApprovalForOffDomainNavigation ?? true
      ? {
        status: 'approvalRequired',
        risk: 'medium',
        reason: `Navigation to ${hostname} is outside the browser domain allowlist.`,
      }
      : {
        status: 'blocked',
        risk: 'medium',
        reason: `Navigation to ${hostname} is outside the browser domain allowlist.`,
      };
  }

  evaluateClick(element: BrowserSnapshotElement): BrowserPolicyDecision {
    const targetText = [element.name, element.text, element.href].filter(Boolean).join(' ').toLowerCase();
    const forbidden = this.forbiddenActionText().find((pattern) => targetText.includes(pattern.toLowerCase()));
    if (forbidden) {
      return {
        status: 'blocked',
        risk: 'high',
        reason: `Click target matches forbidden browser action text: ${forbidden}`,
      };
    }

    const hrefDecision = element.href ? this.evaluateNavigation(element.href) : { status: 'allowed' as const };
    if (hrefDecision.status !== 'allowed') {
      return hrefDecision;
    }

    return { status: 'allowed', risk: 'low' };
  }

  maxElementsPerSnapshot(): number {
    return this.config.maxElementsPerSnapshot ?? 80;
  }

  private forbiddenActionText(): string[] {
    return this.config.forbiddenActionText ?? DEFAULT_FORBIDDEN_BROWSER_ACTION_TEXT;
  }

  private isAllowedHostname(hostname: string): boolean {
    const normalizedHostname = hostname.toLowerCase();
    return this.config.allowedDomains
      .map((domain) => domain.toLowerCase())
      .some((domain) => normalizedHostname === domain || normalizedHostname.endsWith(`.${domain}`));
  }

  private hostnameFromUrl(url: string): string | undefined {
    try {
      return new URL(url).hostname;
    } catch {
      return undefined;
    }
  }
}
