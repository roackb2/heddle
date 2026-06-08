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
});
