import { describe, expect, it } from 'vitest';

import { BrowserAutomationIntentContextService } from '../../../core/browser/index.js';

describe('BrowserAutomationIntentContextService', () => {
  it('leaves system context unchanged when no browser intent is selected', () => {
    expect(BrowserAutomationIntentContextService.append({
      systemContext: 'Existing context.',
    })).toBe('Existing context.');
  });

  it('adds task-level browser guidance without naming a specific site', () => {
    const context = BrowserAutomationIntentContextService.append({
      intent: 'preferred',
      systemContext: 'Existing context.',
    });

    expect(context).toContain('Existing context.');
    expect(context).toContain('Browser automation was explicitly requested');
    expect(context).toContain('Use the URL, page, product, app, or workflow named by the user');
    expect(context).not.toContain('example.com');
    expect(context).not.toContain('Airspace');
    expect(context).not.toContain('Shopee');
  });
});
