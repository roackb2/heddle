export type ClientSharedFileMentionToken = {
  query: string;
  start: number;
  end: number;
};

/**
 * Owns interface-neutral @file mention text semantics.
 *
 * UIs own rendering, keyboard behavior, and API timing. The control plane owns
 * workspace file search. This service owns only the shared local text rules
 * for detecting the active mention token and replacing it with a selected path.
 */
export class ClientSharedFileMentionService {
  static findToken(value: string, cursor: number): ClientSharedFileMentionToken | null {
    const beforeCursor = value.slice(0, cursor);
    const match = beforeCursor.match(/(^|[\s([{"'`])@([^\s@]*)$/);
    if (!match || match.index === undefined) {
      return null;
    }

    const prefix = match[1] ?? '';
    const start = match.index + prefix.length;
    const previousCharacter = value[start - 1];
    if (previousCharacter && /[\w.-]/.test(previousCharacter)) {
      return null;
    }

    return {
      query: match[2] ?? '',
      start,
      end: cursor,
    };
  }

  static insertSelection(
    value: string,
    token: ClientSharedFileMentionToken,
    selectedPath: string,
  ): { value: string; cursor: number } {
    const insertedMention = `@${selectedPath}`;
    const nextValue = `${value.slice(0, token.start)}${insertedMention} ${value.slice(token.end)}`;

    return {
      value: nextValue,
      cursor: token.start + insertedMention.length + 1,
    };
  }

  static tokenKey(token: ClientSharedFileMentionToken): string {
    return `${token.start}:${token.end}:${token.query}`;
  }
}
