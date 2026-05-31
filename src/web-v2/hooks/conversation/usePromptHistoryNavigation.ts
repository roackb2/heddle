import { useCallback, useRef, useState } from 'react';
import type { KeyboardEvent, RefObject } from 'react';
import { ClientSharedPromptInputService } from '@/client-shared/services/prompt-input/index.js';
import type { ClientSharedPromptHistoryState } from '@/client-shared/services/prompt-input/index.js';

export function usePromptHistoryNavigation({
  value,
  onValueChange,
  textareaRef,
  disabled = false,
}: {
  value: string;
  onValueChange: (value: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  disabled?: boolean;
}) {
  const valueRef = useRef(value);
  const [historyState, setHistoryState] = useState<ClientSharedPromptHistoryState>({ entries: [] });
  valueRef.current = value;

  const recordPrompt = useCallback((prompt: string) => {
    setHistoryState((current) => ClientSharedPromptInputService.recordPrompt(current, prompt));
  }, []);

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (disabled || event.defaultPrevented || event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) {
      return false;
    }

    const direction =
      event.key === 'ArrowUp' ? 'previous'
      : event.key === 'ArrowDown' ? 'next'
      : undefined;
    if (!direction) {
      return false;
    }

    const textarea = event.currentTarget;
    if (textarea.selectionStart !== textarea.selectionEnd) {
      return false;
    }

    const currentDraft = {
      value: valueRef.current,
      cursor: textarea.selectionStart,
    };
    if (!ClientSharedPromptInputService.canNavigateHistory(direction, currentDraft)) {
      return false;
    }

    const next = ClientSharedPromptInputService.navigateHistory({
      state: historyState,
      currentDraft,
      direction,
    });
    if (!next) {
      return false;
    }

    event.preventDefault();
    setHistoryState(next.history);
    onValueChange(next.draft.value);

    window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(next.draft.cursor, next.draft.cursor);
    });
    return true;
  }, [disabled, historyState, onValueChange, textareaRef]);

  return {
    recordPrompt,
    handleKeyDown,
  };
}
