import type { TerminalSlashCommandResult, TerminalSlashCommandStatus } from '../types.js';

export function terminalSlashStatusResult(
  label: string,
  detail: string | undefined,
  tone: TerminalSlashCommandStatus['tone'],
): TerminalSlashCommandResult {
  return {
    handled: true,
    status: {
      label,
      ...(detail ? { detail } : {}),
      tone,
    },
  };
}
