import type { ControlPlaneSlashCommandHint } from '@/client-shared/api/types.js';

/**
 * Filters API-provided slash command hints locally for cli-v2 input rendering.
 */
export class SlashCommandAutocompleteService {
  static isSlashDraft(draft: string): boolean {
    const trimmed = draft.trimStart();
    if (!trimmed.startsWith('/')) {
      return false;
    }

    const firstToken = trimmed.slice(1).split(/\s+/, 1)[0] ?? '';
    return !firstToken.includes('/');
  }

  static filterHints(draft: string, hints: ControlPlaneSlashCommandHint[]): ControlPlaneSlashCommandHint[] {
    const trimmed = draft.trimStart();
    if (!SlashCommandAutocompleteService.isSlashDraft(trimmed)) {
      return [];
    }

    const commandPrefix = trimmed.trimEnd();
    const filtered = hints.filter((hint) => (
      hint.command.startsWith(trimmed)
      || hint.command === commandPrefix
      || trimmed === '/'
    ));
    return filtered.length > 0 ? filtered : hints;
  }

  static complete(draft: string, hints: ControlPlaneSlashCommandHint[]): string | undefined {
    const leadingWhitespace = draft.match(/^\s*/)?.[0] ?? '';
    const trimmed = draft.trimStart();
    if (!SlashCommandAutocompleteService.isSlashDraft(trimmed)) {
      return undefined;
    }

    const candidates = Array.from(
      new Set(
        SlashCommandAutocompleteService.filterHints(trimmed, hints)
          .map((hint) => SlashCommandAutocompleteService.hintCommandToCompletionCandidate(hint.command))
          .filter((candidate) => candidate.startsWith(trimmed)),
      ),
    );
    const sharedPrefix = SlashCommandAutocompleteService.longestSharedPrefix(candidates);
    const expandedPrefix =
      candidates.some((candidate) => candidate.startsWith(`${sharedPrefix} `)) ? `${sharedPrefix} ` : sharedPrefix;

    if (expandedPrefix.length > trimmed.length) {
      return `${leadingWhitespace}${expandedPrefix}`;
    }

    return candidates.length === 1 && candidates[0] !== trimmed ? `${leadingWhitespace}${candidates[0]}` : undefined;
  }

  private static hintCommandToCompletionCandidate(command: string): string {
    const placeholderMatch = command.match(/\s(?:<[^>]+>|\[[^\]]+\])/);
    return placeholderMatch?.index === undefined ? command : `${command.slice(0, placeholderMatch.index)} `;
  }

  private static longestSharedPrefix(values: string[]): string {
    let prefix = values[0] ?? '';
    for (const value of values.slice(1)) {
      let index = 0;
      while (index < prefix.length && index < value.length && prefix[index] === value[index]) {
        index += 1;
      }
      prefix = prefix.slice(0, index);
    }
    return prefix;
  }
}
