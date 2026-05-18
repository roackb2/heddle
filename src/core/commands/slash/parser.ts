import type { ParsedSlashCommand } from './types.js';

/**
 * Owns slash-command text parsing and match predicate helpers.
 */
export class SlashCommandParser {
  static parse(input: string): ParsedSlashCommand | undefined {
    const raw = input.trim();
    if (!raw.startsWith('/')) {
      return undefined;
    }

    const body = raw.slice(1).trim();
    if (!body) {
      return {
        raw,
        root: '',
        tokens: [],
        rest: '',
      };
    }

    const firstToken = body.split(/\s+/, 1)[0] ?? '';
    if (firstToken.includes('/')) {
      return undefined;
    }

    const tokens = body.split(/\s+/).filter(Boolean);
    const root = tokens[0] ?? '';
    const rest = body.slice(root.length).trimStart();
    return {
      raw,
      root,
      tokens,
      rest,
    };
  }

  static isInput(input: string): boolean {
    return SlashCommandParser.parse(input) !== undefined;
  }

  static matchesExact(command: string): (input: ParsedSlashCommand) => boolean {
    return (input) => input.raw === command;
  }

  static matchesAnyExact(commands: string[]): (input: ParsedSlashCommand) => boolean {
    const normalized = new Set(commands);
    return (input) => normalized.has(input.raw);
  }

  static matchesPrefix(prefix: string): (input: ParsedSlashCommand) => boolean {
    const normalizedPrefix = prefix.endsWith(' ') ? prefix : `${prefix} `;
    const exactPrefix = normalizedPrefix.trimEnd();
    return (input) => input.raw === exactPrefix || input.raw.startsWith(normalizedPrefix);
  }
}
