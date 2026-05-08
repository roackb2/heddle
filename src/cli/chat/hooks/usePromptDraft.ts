import { useCallback, useState } from 'react';

export function usePromptDraft() {
  const [draft, setDraft] = useState('');
  const [draftCursor, setDraftCursor] = useState(0);
  const [promptHistory, setPromptHistory] = useState<string[]>([]);

  const clearDraft = useCallback(() => {
    setDraft('');
    setDraftCursor(0);
  }, []);

  const replaceDraft = useCallback((value: string) => {
    setDraft(value);
    setDraftCursor(value.length);
  }, []);

  const recordPromptHistory = useCallback((value: string) => {
    if (!value.trim()) {
      return;
    }

    setPromptHistory((current) => {
      if (current[current.length - 1] === value) {
        return current;
      }

      return [...current, value].slice(-100);
    });
  }, []);

  return {
    draft,
    setDraft,
    draftCursor,
    setDraftCursor,
    promptHistory,
    clearDraft,
    replaceDraft,
    recordPromptHistory,
  };
}
