import { useCallback, useState } from 'react';

export function usePromptDraft() {
  const [draft, setDraft] = useState('');

  const clearDraft = useCallback(() => {
    setDraft('');
  }, []);

  return {
    draft,
    setDraft,
    clearDraft,
  };
}
