import { matchesExactSlashCommand } from '../../../core/commands/slash/parser.js';
import type { SlashCommandModule } from '../../../core/commands/slash/types.js';
import type { LocalCommandResult } from '../state/types.js';

export type TuiSlashCommandContext = {
  saveTuiSnapshot?: () => Promise<string> | string;
};

export function createTuiDebugSnapshotCommandModule(): SlashCommandModule<
  LocalCommandResult,
  TuiSlashCommandContext
> {
  return {
    id: 'tui.debug-snapshot',
    hints: [
      { command: '/debug tui-snapshot', description: 'save the latest rendered TUI frame for inspection' },
    ],
    commands: [
      {
        id: 'tui.debug-snapshot.save',
        syntax: '/debug tui-snapshot',
        description: 'save the latest rendered TUI frame for inspection',
        match: matchesExactSlashCommand('/debug tui-snapshot'),
        run: async (context) => ({
          handled: true,
          kind: 'message',
          message: context.saveTuiSnapshot ?
            await context.saveTuiSnapshot()
          : 'TUI snapshots are not available in this runtime.',
        }),
      },
    ],
  };
}
