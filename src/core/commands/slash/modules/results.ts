import type { ParsedSlashCommand } from '../types.js';
import type { CoreSlashCommandResult } from './context.js';

export function slashMessageResult(message: string, sessionId?: string): CoreSlashCommandResult {
  return {
    handled: true,
    kind: 'message',
    message,
    sessionId,
  };
}

export function argumentAfterPrefix(input: ParsedSlashCommand, prefix: string): string {
  return input.raw.slice(prefix.length).trim();
}

export function formatCommandError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
