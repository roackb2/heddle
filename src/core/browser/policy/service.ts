import type { BrowserPolicyConfig, BrowserPolicyDecision, BrowserSnapshotElement } from '../types.js';

export const DEFAULT_BLOCKED_BROWSER_ACTION_TEXT = [
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
  'buy now',
];

export const DEFAULT_APPROVAL_REQUIRED_BROWSER_ACTION_TEXT = [
  'add to cart',
  'add bag',
  'add to bag',
  'add basket',
  'add to basket',
];

export const DEFAULT_FORBIDDEN_BROWSER_ACTION_TEXT = DEFAULT_BLOCKED_BROWSER_ACTION_TEXT;

/**
 * Owns browser navigation and action policy decisions.
 */
export class BrowserPolicyService {
  private readonly allowedDomains: string[];

  constructor(private readonly config: BrowserPolicyConfig) {
    this.allowedDomains = [...config.allowedDomains];
  }

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
    const blocked = this.blockedActionText().find((pattern) => targetText.includes(pattern.toLowerCase()));
    if (blocked) {
      return {
        status: 'blocked',
        risk: 'high',
        reason: `Click target matches blocked browser action text: ${blocked}`,
      };
    }

    const approvalRequired = this.approvalRequiredActionText()
      .find((pattern) => targetText.includes(pattern.toLowerCase()));
    if (approvalRequired) {
      return {
        status: 'approvalRequired',
        risk: 'medium',
        reason: `Click target requires approval for browser action text: ${approvalRequired}`,
      };
    }

    if (!element.href) {
      return this.config.requireApprovalForOffDomainNavigation ?? true
        ? {
          status: 'approvalRequired',
          risk: 'medium',
          reason: 'Click target does not expose a browser navigation URL before execution.',
        }
        : {
          status: 'blocked',
          risk: 'medium',
          reason: 'Click target does not expose a browser navigation URL before execution.',
        };
    }

    const hrefDecision = this.evaluateNavigation(element.href);
    if (hrefDecision.status !== 'allowed') {
      return hrefDecision;
    }

    return { status: 'allowed', risk: 'low' };
  }

  evaluateType(element: BrowserSnapshotElement): BrowserPolicyDecision {
    if (!element.editable) {
      return {
        status: 'blocked',
        risk: 'medium',
        reason: 'Type target is not an editable browser field.',
      };
    }

    if (element.disabled || element.readonly) {
      return {
        status: 'blocked',
        risk: 'medium',
        reason: 'Type target is disabled or read-only.',
      };
    }

    const targetText = [
      element.name,
      element.text,
      element.placeholder,
      element.inputType,
      element.tagName,
    ].filter(Boolean).join(' ').toLowerCase();

    const sensitivePatterns = [
      'password',
      'passcode',
      'one-time',
      'otp',
      '2fa',
      'verification code',
      'credit card',
      'card number',
      'security code',
      'cvv',
      'cvc',
    ];
    const sensitive = sensitivePatterns.find((pattern) => targetText.includes(pattern));
    if (sensitive) {
      return {
        status: 'blocked',
        risk: 'high',
        reason: `Type target appears sensitive: ${sensitive}`,
      };
    }

    return { status: 'allowed', risk: 'low' };
  }

  maxElementsPerSnapshot(): number {
    return this.config.maxElementsPerSnapshot ?? 80;
  }

  adoptAllowedDomainFromUrl(url: string): BrowserPolicyDecision {
    const hostname = this.hostnameFromUrl(url);
    if (!hostname) {
      return {
        status: 'blocked',
        risk: 'medium',
        reason: `Invalid browser navigation URL: ${url}`,
      };
    }

    const domains = this.allowedDomainsFromHostname(hostname);
    for (const domain of domains) {
      if (!this.allowedDomains.includes(domain)) {
        this.allowedDomains.push(domain);
      }
    }

    return { status: 'allowed', risk: 'low' };
  }

  private blockedActionText(): string[] {
    return this.config.forbiddenActionText ?? DEFAULT_FORBIDDEN_BROWSER_ACTION_TEXT;
  }

  private approvalRequiredActionText(): string[] {
    return DEFAULT_APPROVAL_REQUIRED_BROWSER_ACTION_TEXT;
  }

  private isAllowedHostname(hostname: string): boolean {
    const normalizedHostname = hostname.toLowerCase();
    return this.allowedDomains
      .map((domain) => domain.toLowerCase())
      .some((domain) => normalizedHostname === domain || normalizedHostname.endsWith(`.${domain}`));
  }

  private allowedDomainsFromHostname(hostname: string): string[] {
    const normalizedHostname = hostname.toLowerCase();
    return normalizedHostname.startsWith('www.')
      ? [normalizedHostname.slice(4), normalizedHostname]
      : [normalizedHostname];
  }

  private hostnameFromUrl(url: string): string | undefined {
    try {
      return new URL(url).hostname;
    } catch {
      return undefined;
    }
  }
}
