import { describe, expect, it } from 'vitest';
import { SlashCommandAutocompleteService } from '@/cli-v2/services/slash-commands/index.js';
import type { ControlPlaneSlashCommandHint } from '@/client-shared/api/types.js';

describe('SlashCommandAutocompleteService', () => {
  const hints: ControlPlaneSlashCommandHint[] = [
    { command: '/skills', description: 'list Agent Skills and activation status' },
    { command: '/skills enable <name>', description: 'activate one Agent Skill' },
    { command: '/skills disable <name>', description: 'disable one Agent Skill' },
  ];

  it('keeps exact parent commands visible when the draft has trailing space', () => {
    expect(SlashCommandAutocompleteService.filterHints('/skills ', hints)).toEqual(hints);
  });

  it('can suppress fallback hints for local-only command aliases', () => {
    const localHints: ControlPlaneSlashCommandHint[] = [
      { command: '/a', description: 'toggle terminal activity details' },
      { command: '/d', description: 'open terminal diff review' },
    ];

    expect(SlashCommandAutocompleteService.filterHints('/browser ', localHints, { fallback: false })).toEqual([]);
  });

  it('keeps matching browser subcommands visible after the parent command', () => {
    const browserHints: ControlPlaneSlashCommandHint[] = [
      { command: '/browser', description: 'show Browser Automation status' },
      { command: '/browser enable', description: 'enable Browser Automation' },
      { command: '/browser disable', description: 'disable Browser Automation' },
      { command: '/browser headed', description: 'run in a visible browser window' },
      { command: '/browser headless', description: 'run without a visible browser window' },
      { command: '/browser profile <id>', description: 'select profile' },
      { command: '/browser backend <playwright|native-chrome>', description: 'select backend' },
      { command: '/browser endpoint <url>', description: 'set native Chrome CDP endpoint' },
      { command: '/browser channel <chromium|chrome|msedge>', description: 'select channel' },
      { command: '/browser open-profile [url]', description: 'open selected profile' },
      { command: '/browser close-profile', description: 'close selected profile' },
    ];

    expect(SlashCommandAutocompleteService.filterHints('/browser ', browserHints)).toEqual(browserHints);
  });
});
