import { useCallback, useState } from 'react';

export function usePromptDraft() {
  const [draft, setDraft] = useState('');
  const [draftCursor, setDraftCursor] = useState(0);

  const clearDraft = useCallback(() => {
    setDraft('');
    setDraftCursor(0);
  }, []);

  const replaceDraft = useCallback((value: string) => {
    setDraft(value);
    setDraftCursor(value.length);
  }, []);

  return {
    draft,
    setDraft,
    draftCursor,
    setDraftCursor,
    clearDraft,
    replaceDraft,
  };
}
