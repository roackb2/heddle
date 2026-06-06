import { describe, expect, it } from 'vitest';

import { BrowserPolicyService } from '../../../core/browser/index.js';

describe('BrowserPolicyService', () => {
  it('allows allowlisted domains and subdomains', () => {
    const policy = new BrowserPolicyService({ allowedDomains: ['wikipedia.org'] });

    expect(policy.evaluateNavigation('https://en.wikipedia.org/wiki/Browser_automation')).toMatchObject({
      status: 'allowed',
    });
    expect(policy.evaluateNavigation('https://wikipedia.org/')).toMatchObject({
      status: 'allowed',
    });
  });

  it('requires approval for off-domain navigation by default', () => {
    const policy = new BrowserPolicyService({ allowedDomains: ['wikipedia.org'] });

    expect(policy.evaluateNavigation('https://example.com')).toMatchObject({
      status: 'approvalRequired',
      risk: 'medium',
    });
  });

  it('can hard-block off-domain navigation', () => {
    const policy = new BrowserPolicyService({
      allowedDomains: ['wikipedia.org'],
      requireApprovalForOffDomainNavigation: false,
    });

    expect(policy.evaluateNavigation('https://example.com')).toMatchObject({
      status: 'blocked',
      risk: 'medium',
    });
  });

  it('blocks forbidden click targets before execution', () => {
    const policy = new BrowserPolicyService({ allowedDomains: ['shop.example'] });

    expect(policy.evaluateClick({
      ref: 'el_1',
      role: 'button',
      name: 'Buy now',
      text: 'Buy now',
      tagName: 'button',
    })).toMatchObject({
      status: 'blocked',
      risk: 'high',
    });
  });

  it('requires approval for click targets that navigate off-domain', () => {
    const policy = new BrowserPolicyService({ allowedDomains: ['wikipedia.org'] });

    expect(policy.evaluateClick({
      ref: 'el_1',
      role: 'link',
      name: 'External source',
      href: 'https://example.com/source',
      tagName: 'a',
    })).toMatchObject({
      status: 'approvalRequired',
      risk: 'medium',
    });
  });

  it('classifies forbidden click text before off-domain navigation', () => {
    const policy = new BrowserPolicyService({ allowedDomains: ['wikipedia.org'] });

    expect(policy.evaluateClick({
      ref: 'el_1',
      role: 'link',
      name: 'Checkout on external shop',
      href: 'https://example.com/checkout',
      tagName: 'a',
    })).toMatchObject({
      status: 'blocked',
      risk: 'high',
      reason: expect.stringContaining('forbidden browser action text'),
    });
  });
});
