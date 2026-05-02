import type { ParsedSlashCommand } from './types.js';

export function parseSlashCommand(input: string): ParsedSlashCommand | undefined {
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

export function isSlashCommandInput(input: string): boolean {
  return parseSlashCommand(input) !== undefined;
}

export function matchesExactSlashCommand(command: string): (input: ParsedSlashCommand) => boolean {
  return (input) => input.raw === command;
}

export function matchesAnyExactSlashCommand(commands: string[]): (input: ParsedSlashCommand) => boolean {
  const normalized = new Set(commands);
  return (input) => normalized.has(input.raw);
}

export function matchesSlashCommandPrefix(prefix: string): (input: ParsedSlashCommand) => boolean {
  const normalizedPrefix = prefix.endsWith(' ') ? prefix : `${prefix} `;
  const exactPrefix = normalizedPrefix.trimEnd();
  return (input) => input.raw === exactPrefix || input.raw.startsWith(normalizedPrefix);
}

