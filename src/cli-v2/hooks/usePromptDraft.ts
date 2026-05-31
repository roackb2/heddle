import { useCallback, useState } from 'react';
import { ClientSharedPromptInputService } from '@/client-shared/services/prompt-input/index.js';
import type {
  ClientSharedPromptDraftState,
  ClientSharedPromptHistoryDirection,
  ClientSharedPromptHistoryState,
} from '@/client-shared/services/prompt-input/index.js';

export function usePromptDraft() {
  const [draftState, setDraftStateValue] = useState<ClientSharedPromptDraftState>({ value: '', cursor: 0 });
  const [historyState, setHistoryState] = useState<ClientSharedPromptHistoryState>({ entries: [] });

  const setDraftState = useCallback((nextState: ClientSharedPromptDraftState) => {
    setDraftStateValue({
      value: nextState.value,
      cursor: ClientSharedPromptInputService.clampCursor(nextState.value, nextState.cursor),
    });
    setHistoryState((current) => ({
      entries: current.entries,
      index: undefined,
      savedDraft: undefined,
    }));
  }, []);

  const setDraft = useCallback((value: string) => {
    setDraftState({ value, cursor: value.length });
  }, [setDraftState]);

  const clearDraft = useCallback(() => {
    setDraftState({ value: '', cursor: 0 });
  }, [setDraftState]);

  const recordSubmittedPrompt = useCallback((value: string) => {
    setHistoryState((current) => ClientSharedPromptInputService.recordPrompt(current, value));
  }, []);

  const navigateHistory = useCallback((direction: ClientSharedPromptHistoryDirection) => {
    const next = ClientSharedPromptInputService.navigateHistory({
      state: historyState,
      currentDraft: draftState,
      direction,
    });
    if (!next) {
      return;
    }

    setHistoryState(next.history);
    setDraftStateValue(next.draft);
  }, [draftState, historyState]);

  return {
    draft: draftState.value,
    cursor: draftState.cursor,
    setDraft,
    setDraftState,
    clearDraft,
    recordSubmittedPrompt,
    navigateHistory,
  };
}
