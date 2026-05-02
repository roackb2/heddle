import { matchesExactSlashCommand } from '../../parser.js';
import type { SlashCommandResult } from '../../result-types.js';
import type { SlashCommandModule } from '../../types.js';
import type { SlashCommandExecutionContext } from '../context.js';
import { slashMessageResult } from '../results.js';

export function createCompactionSlashCommandModule(): SlashCommandModule<SlashCommandResult, SlashCommandExecutionContext> {
  return {
    id: 'compaction',
    hints: [
      { command: '/compact', description: 'compact earlier session history for the next run' },
    ],
    commands: [
      {
        id: 'compaction.compact',
        syntax: '/compact',
        description: 'compact earlier session history for the next run',
        match: matchesExactSlashCommand('/compact'),
        run: async (context) => slashMessageResult(await context.compaction.compactActive()),
      },
    ],
  };
}
