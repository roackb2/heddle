import type { ParsedTerminalSlashCommand } from './types.js';

/**
 * Owns cli-v2 prompt slash-command text parsing and match predicates.
 */
export class TerminalSlashCommandParser {
  static parse(input: string): ParsedTerminalSlashCommand | undefined {
    const raw = input.trim();
    if (!raw.startsWith('/')) {
      return undefined;
    }

    const body = raw.slice(1).trim();
    const firstToken = body.split(/\s+/, 1)[0] ?? '';
    if (firstToken.includes('/')) {
      return undefined;
    }

    const root = `/${firstToken}`;
    return {
      raw,
      root,
      rest: body.slice(firstToken.length).trimStart(),
    };
  }

  static isInput(input: string): boolean {
    return TerminalSlashCommandParser.parse(input) !== undefined;
  }

  static matchesExact(command: string): (input: ParsedTerminalSlashCommand) => boolean {
    return (input) => input.raw === command;
  }

  static matchesAnyExact(commands: string[]): (input: ParsedTerminalSlashCommand) => boolean {
    const normalized = new Set(commands);
    return (input) => normalized.has(input.raw);
  }

  static matchesPrefix(prefix: string): (input: ParsedTerminalSlashCommand) => boolean {
    const normalizedPrefix = prefix.endsWith(' ') ? prefix : `${prefix} `;
    const exactPrefix = normalizedPrefix.trimEnd();
    return (input) => input.raw === exactPrefix || input.raw.startsWith(normalizedPrefix);
  }
}
