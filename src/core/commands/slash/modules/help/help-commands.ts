import { SlashCommandParser } from '../../parser.js';
import type { SlashCommandResult } from '../../result-types.js';
import type { SlashCommandModule } from '../../types.js';
import type { SlashCommandExecutionContext } from '../context.js';
import { slashMessageResult } from '../results.js';

export function createHelpSlashCommandModule(): SlashCommandModule<SlashCommandResult, SlashCommandExecutionContext> {
  return {
    id: 'help',
    commands: [
      {
        id: 'help.show',
        syntax: '/help',
        description: 'show available slash commands',
        match: SlashCommandParser.matchesExact('/help'),
        run: (context) => slashMessageResult(context.help.message()),
      },
    ],
  };
}
