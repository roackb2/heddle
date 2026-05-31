export type ClientSharedPromptDraftState = {
  value: string;
  cursor: number;
};

export type ClientSharedPromptHistoryState = {
  entries: string[];
  index?: number;
  savedDraft?: ClientSharedPromptDraftState;
};

export type ClientSharedPromptHistoryDirection = 'previous' | 'next';

const DEFAULT_MAX_PROMPT_HISTORY_ENTRIES = 100;

/**
 * Owns interface-neutral prompt draft and prompt history semantics.
 *
 * Interfaces own key-event capture and rendering. This service owns the pure
 * text-editing and prompt-history rules so web-v2 and cli-v2 do not drift on
 * which submitted prompts are recorded or how history navigation restores a
 * draft that was in progress before browsing history.
 */
export class ClientSharedPromptInputService {
  static clampCursor(value: string, cursor: number): number {
    return Math.min(Math.max(0, cursor), value.length);
  }

  static insertText(state: ClientSharedPromptDraftState, input: string): ClientSharedPromptDraftState {
    const cursor = this.clampCursor(state.value, state.cursor);
    return {
      value: `${state.value.slice(0, cursor)}${input}${state.value.slice(cursor)}`,
      cursor: cursor + input.length,
    };
  }

  static deletePreviousCharacter(state: ClientSharedPromptDraftState): ClientSharedPromptDraftState {
    const cursor = this.clampCursor(state.value, state.cursor);
    if (cursor === 0) {
      return { value: state.value, cursor };
    }

    return {
      value: this.removeRange(state.value, cursor - 1, cursor),
      cursor: cursor - 1,
    };
  }

  static deletePreviousWord(state: ClientSharedPromptDraftState): ClientSharedPromptDraftState {
    const cursor = this.clampCursor(state.value, state.cursor);
    const nextCursor = this.findPreviousWordBoundary(state.value, cursor);
    return {
      value: this.removeRange(state.value, nextCursor, cursor),
      cursor: nextCursor,
    };
  }

  static deleteBeforeCursor(state: ClientSharedPromptDraftState): ClientSharedPromptDraftState {
    const cursor = this.clampCursor(state.value, state.cursor);
    return {
      value: state.value.slice(cursor),
      cursor: 0,
    };
  }

  static deleteAfterCursor(state: ClientSharedPromptDraftState): ClientSharedPromptDraftState {
    const cursor = this.clampCursor(state.value, state.cursor);
    return {
      value: state.value.slice(0, cursor),
      cursor,
    };
  }

  static moveCursor(
    state: ClientSharedPromptDraftState,
    direction: 'start' | 'end' | 'previousCharacter' | 'nextCharacter' | 'previousWord' | 'nextWord',
  ): number {
    const cursor = this.clampCursor(state.value, state.cursor);
    const movements: Record<typeof direction, () => number> = {
      start: () => 0,
      end: () => state.value.length,
      previousCharacter: () => Math.max(0, cursor - 1),
      nextCharacter: () => Math.min(state.value.length, cursor + 1),
      previousWord: () => this.findPreviousWordBoundary(state.value, cursor),
      nextWord: () => this.findNextWordBoundary(state.value, cursor),
    };

    return movements[direction]();
  }

  static recordPrompt(
    state: ClientSharedPromptHistoryState,
    value: string,
    maxEntries = DEFAULT_MAX_PROMPT_HISTORY_ENTRIES,
  ): ClientSharedPromptHistoryState {
    const trimmed = value.trim();
    if (!trimmed) {
      return state;
    }

    return {
      entries: [...state.entries.filter((entry) => entry !== trimmed), trimmed].slice(-maxEntries),
      index: undefined,
      savedDraft: undefined,
    };
  }

  static navigateHistory(args: {
    state: ClientSharedPromptHistoryState;
    currentDraft: ClientSharedPromptDraftState;
    direction: ClientSharedPromptHistoryDirection;
  }): { history: ClientSharedPromptHistoryState; draft: ClientSharedPromptDraftState } | undefined {
    const { entries, index, savedDraft } = args.state;
    if (entries.length === 0) {
      return undefined;
    }

    if (args.direction === 'previous') {
      const nextIndex = index === undefined ? entries.length - 1 : Math.max(0, index - 1);
      const value = entries[nextIndex] ?? '';
      return {
        history: {
          entries,
          index: nextIndex,
          savedDraft: savedDraft ?? args.currentDraft,
        },
        draft: { value, cursor: value.length },
      };
    }

    if (index === undefined) {
      return undefined;
    }

    if (index < entries.length - 1) {
      const nextIndex = index + 1;
      const value = entries[nextIndex] ?? '';
      return {
        history: {
          entries,
          index: nextIndex,
          savedDraft,
        },
        draft: { value, cursor: value.length },
      };
    }

    return {
      history: {
        entries,
        index: undefined,
        savedDraft: undefined,
      },
      draft: savedDraft ?? { value: '', cursor: 0 },
    };
  }

  static canNavigateHistory(
    direction: ClientSharedPromptHistoryDirection,
    state: ClientSharedPromptDraftState,
  ): boolean {
    if (!state.value.includes('\n')) {
      return true;
    }

    if (direction === 'previous') {
      const firstLineEnd = state.value.indexOf('\n');
      return state.cursor <= firstLineEnd;
    }

    const lastLineStart = state.value.lastIndexOf('\n') + 1;
    return state.cursor >= lastLineStart;
  }

  private static removeRange(value: string, start: number, end: number): string {
    return `${value.slice(0, start)}${value.slice(end)}`;
  }

  private static findPreviousWordBoundary(value: string, cursor: number): number {
    let index = cursor;

    while (index > 0 && isWordBoundary(value[index - 1])) {
      index--;
    }

    while (index > 0 && !isWordBoundary(value[index - 1])) {
      index--;
    }

    return index;
  }

  private static findNextWordBoundary(value: string, cursor: number): number {
    let index = cursor;

    while (index < value.length && isWordBoundary(value[index])) {
      index++;
    }

    while (index < value.length && !isWordBoundary(value[index])) {
      index++;
    }

    return index;
  }
}

function isWordBoundary(char: string | undefined): boolean {
  return !char || /\s|[.,/#!$%^&*;:{}=\-_`~()\[\]"'<>?\\|]/.test(char);
}
