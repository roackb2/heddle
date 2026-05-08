import { useCallback, useEffect, useRef, useState } from 'react';
import type { PromptDraftState } from './usePromptUndoRedo.js';

const MAX_PROMPT_HISTORY_ENTRIES = 100;

export function usePromptHistory() {
  const [promptHistory, setPromptHistory] = useState<string[]>([]);

  const recordPromptHistory = useCallback((value: string) => {
    if (!value.trim()) {
      return;
    }

    setPromptHistory((current) => {
      if (current[current.length - 1] === value) {
        return current;
      }

      return [...current, value].slice(-MAX_PROMPT_HISTORY_ENTRIES);
    });
  }, []);

  return {
    promptHistory,
    recordPromptHistory,
  };
}

export function usePromptHistoryNavigation(promptHistory: string[]) {
  const promptHistoryRef = useRef(promptHistory);
  const promptHistoryIndexRef = useRef<number | undefined>(undefined);
  const savedDraftBeforeHistoryRef = useRef<PromptDraftState | undefined>(undefined);

  useEffect(() => {
    promptHistoryRef.current = promptHistory;
  }, [promptHistory]);

  const resetPromptHistoryNavigation = useCallback(() => {
    promptHistoryIndexRef.current = undefined;
    savedDraftBeforeHistoryRef.current = undefined;
  }, []);

  const navigatePromptHistory = useCallback((direction: 'previous' | 'next', current: PromptDraftState): PromptDraftState | undefined => {
    const next = resolvePromptHistoryNavigation({
      direction,
      history: promptHistoryRef.current,
      current,
      historyIndex: promptHistoryIndexRef.current,
      savedDraftBeforeHistory: savedDraftBeforeHistoryRef.current,
    });
    if (!next) {
      return undefined;
    }

    promptHistoryIndexRef.current = next.historyIndex;
    savedDraftBeforeHistoryRef.current = next.savedDraftBeforeHistory;
    return next.state;
  }, []);

  return {
    resetPromptHistoryNavigation,
    navigatePromptHistory,
  };
}

export function canNavigatePromptHistory(direction: 'previous' | 'next', state: PromptDraftState): boolean {
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

export function resolvePromptHistoryNavigation(args: {
  direction: 'previous' | 'next';
  history: string[];
  current: PromptDraftState;
  historyIndex?: number;
  savedDraftBeforeHistory?: PromptDraftState;
}): { state: PromptDraftState; historyIndex?: number; savedDraftBeforeHistory?: PromptDraftState } | undefined {
  if (args.history.length === 0) {
    return undefined;
  }

  if (args.direction === 'previous') {
    const historyIndex =
      args.historyIndex === undefined ?
        args.history.length - 1
      : Math.max(0, args.historyIndex - 1);
    const value = args.history[historyIndex] ?? '';
    return {
      state: { value, cursor: value.length },
      historyIndex,
      savedDraftBeforeHistory: args.savedDraftBeforeHistory ?? args.current,
    };
  }

  if (args.historyIndex === undefined) {
    return undefined;
  }

  if (args.historyIndex < args.history.length - 1) {
    const historyIndex = args.historyIndex + 1;
    const value = args.history[historyIndex] ?? '';
    return {
      state: { value, cursor: value.length },
      historyIndex,
      savedDraftBeforeHistory: args.savedDraftBeforeHistory,
    };
  }

  return {
    state: args.savedDraftBeforeHistory ?? { value: '', cursor: 0 },
    historyIndex: undefined,
    savedDraftBeforeHistory: undefined,
  };
}
