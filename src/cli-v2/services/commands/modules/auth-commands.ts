import { TerminalSlashCommandParser } from '../terminal-slash-command-parser.js';
import type { TerminalSlashCommandModule } from '../types.js';
import { terminalSlashStatusResult } from './results.js';

export function createTerminalAuthSlashCommandModule(): TerminalSlashCommandModule {
  return {
    id: 'auth',
    hints: [
      { command: '/auth', description: 'show auth guidance for cli-v2' },
    ],
    commands: [
      {
        id: 'auth.guidance',
        syntax: '/auth',
        description: 'show auth guidance for cli-v2',
        match: TerminalSlashCommandParser.matchesExact('/auth'),
        execute: () => terminalSlashStatusResult(
          'Auth commands are not available inside cli-v2 yet',
          'Use the top-level heddle auth command outside this TUI.',
          'warning',
        ),
      },
    ],
  };
}
