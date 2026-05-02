import { parseSlashCommand } from './parser.js';
import type { SlashCommandHint } from './types.js';

export function filterSlashCommandHints(
  draft: string,
  hints: SlashCommandHint[],
): SlashCommandHint[] {
  const trimmedStart = draft.trimStart();
  if (!parseSlashCommand(trimmedStart)) {
    return [];
  }

  const filtered = hints.filter((hint) => hint.command.startsWith(trimmedStart) || trimmedStart === '/');
  return filtered.length > 0 ? filtered : hints;
}

export function autocompleteSlashCommand(
  draft: string,
  hints: SlashCommandHint[],
): string | undefined {
  const leadingWhitespace = draft.match(/^\s*/)?.[0] ?? '';
  const trimmedStart = draft.trimStart();
  if (!parseSlashCommand(trimmedStart)) {
    return undefined;
  }

  const candidates = Array.from(
    new Set(
      filterSlashCommandHints(trimmedStart, hints)
        .map((hint) => hintCommandToCompletionCandidate(hint.command))
        .filter((candidate) => candidate.startsWith(trimmedStart)),
    ),
  );
  if (candidates.length === 0) {
    return undefined;
  }

  const sharedPrefix = longestSharedPrefix(candidates);
  const expandedPrefix =
    candidates.some((candidate) => candidate.startsWith(`${sharedPrefix} `)) ? `${sharedPrefix} ` : sharedPrefix;
  if (expandedPrefix.length > trimmedStart.length) {
    return `${leadingWhitespace}${expandedPrefix}`;
  }

  if (candidates.length === 1 && candidates[0] !== trimmedStart) {
    return `${leadingWhitespace}${candidates[0]}`;
  }

  return undefined;
}

export function hintCommandToCompletionCandidate(command: string): string {
  const placeholderMatch = command.match(/\s(?:<[^>]+>|\[[^\]]+\])/);
  if (!placeholderMatch || placeholderMatch.index === undefined) {
    return command;
  }

  return `${command.slice(0, placeholderMatch.index)} `;
}

export function longestSharedPrefix(values: string[]): string {
  if (values.length === 0) {
    return '';
  }

  let prefix = values[0] ?? '';
  for (const value of values.slice(1)) {
    let index = 0;
    while (index < prefix.length && index < value.length && prefix[index] === value[index]) {
      index += 1;
    }
    prefix = prefix.slice(0, index);
    if (!prefix) {
      break;
    }
  }

  return prefix;
}

