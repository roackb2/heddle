import type { TerminalSlashCommandModule } from '../types.js';
import { createTerminalAuthSlashCommandModule } from './auth-commands.js';
import { createTerminalSessionSlashCommandModule } from './session-commands.js';

export function createTerminalSlashCommandModules(): TerminalSlashCommandModule[] {
  return [
    createTerminalSessionSlashCommandModule(),
    createTerminalAuthSlashCommandModule(),
  ];
}
