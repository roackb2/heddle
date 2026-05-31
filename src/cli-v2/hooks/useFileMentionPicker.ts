import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import debounce from 'debounce';
import type { ControlPlaneWorkspaceFileSuggestion } from '@/client-shared/api/types.js';
import { ClientSharedFileMentionService } from '@/client-shared/services/file-mentions/index.js';
import type { PromptInputKey } from '../components/PromptInput.js';
import { CliV2PickerService } from '../services/pickers/index.js';
import type {
  ControlPlaneSessionStore,
  ControlPlaneSessionStoreSnapshot,
} from '../state/control-plane-session-store.js';

const FILE_MENTION_DEBOUNCE_MS = 220;
const FILE_MENTION_LIMIT = 20;

export function useFileMentionPicker({
  draft,
  setDraft,
  snapshot,
  store,
}: {
  draft: string;
  setDraft: (value: string) => void;
  snapshot: ControlPlaneSessionStoreSnapshot;
  store: ControlPlaneSessionStore;
}) {
  const [suggestions, setSuggestions] = useState<ControlPlaneWorkspaceFileSuggestion[]>([]);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [dismissedTokenKey, setDismissedTokenKey] = useState<string | undefined>();
  const currentTokenKeyRef = useRef<string | undefined>(undefined);
  const mentionToken = ClientSharedFileMentionService.findToken(draft, draft.length);
  const tokenKey = mentionToken ? ClientSharedFileMentionService.tokenKey(mentionToken) : undefined;
  const query = mentionToken?.query ?? '';
  const visible = Boolean(mentionToken && tokenKey !== dismissedTokenKey);

  const search = useMemo(() => debounce(async (query: string, requestedTokenKey: string) => {
    try {
      const files = await store.searchWorkspaceFileMentions(query, FILE_MENTION_LIMIT);
      if (currentTokenKeyRef.current !== requestedTokenKey) {
        return;
      }

      setSuggestions(files);
      setError(undefined);
    } catch (caught) {
      setSuggestions([]);
      setError(formatError(caught));
    } finally {
      if (currentTokenKeyRef.current === requestedTokenKey) {
        setLoading(false);
      }
    }
  }, FILE_MENTION_DEBOUNCE_MS), [store]);

  useEffect(() => {
    currentTokenKeyRef.current = tokenKey;

    if (!tokenKey || !visible || !snapshot.workspaceId) {
      search.clear();
      setSuggestions([]);
      setLoading(false);
      setError(undefined);
      return;
    }

    setLoading(true);
    search(query, tokenKey);

    return () => search.clear();
  }, [query, search, snapshot.workspaceId, tokenKey, visible]);

  useEffect(() => {
    setHighlightedIndex(0);
  }, [mentionToken?.query]);

  useEffect(() => {
    setHighlightedIndex((index) => CliV2PickerService.clampIndex(index, suggestions.length));
  }, [suggestions.length]);

  useEffect(() => {
    if (tokenKey !== dismissedTokenKey) {
      setDismissedTokenKey(undefined);
    }
  }, [dismissedTokenKey, tokenKey]);

  const insertSuggestion = useCallback((suggestion: ControlPlaneWorkspaceFileSuggestion) => {
    if (!mentionToken) {
      return;
    }

    setDraft(ClientSharedFileMentionService.insertSelection(draft, mentionToken, suggestion.path).value);
    setSuggestions([]);
    setHighlightedIndex(0);
    setDismissedTokenKey(undefined);
  }, [draft, mentionToken, setDraft]);

  const handleSpecialKey = useCallback((_input: string, key: PromptInputKey) => {
    if (!visible) {
      return false;
    }

    if ((key.upArrow || key.leftArrow) && suggestions.length > 0) {
      setHighlightedIndex((current) => CliV2PickerService.previousIndex(current, suggestions.length));
      return true;
    }

    if ((key.downArrow || key.rightArrow) && suggestions.length > 0) {
      setHighlightedIndex((current) => CliV2PickerService.nextIndex(current, suggestions.length));
      return true;
    }

    if ((key.tab || key.return) && suggestions[highlightedIndex]) {
      insertSuggestion(suggestions[highlightedIndex]);
      return true;
    }

    if ((key.tab || key.return) && loading) {
      return true;
    }

    if (key.escape) {
      setDismissedTokenKey(tokenKey);
      setSuggestions([]);
      setLoading(false);
      return true;
    }

    return false;
  }, [highlightedIndex, insertSuggestion, loading, suggestions, tokenKey, visible]);

  return {
    visible,
    query,
    suggestions,
    highlightedIndex,
    loading,
    error,
    handleSpecialKey,
  };
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : 'File search failed';
}
