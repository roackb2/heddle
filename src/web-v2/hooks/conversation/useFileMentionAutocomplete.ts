import { skipToken } from '@tanstack/react-query';
import debounce from 'debounce';
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  ChangeEvent,
  KeyboardEvent,
  RefObject,
  SyntheticEvent,
} from 'react';
import { trpcReact, type RouterOutputs } from '@web/api/client';
import { ClientSharedFileMentionService } from '@/client-shared/services/file-mentions/index.js';

export type FileMentionSuggestion = RouterOutputs['controlPlane']['workspaceFileSearch']['files'][number];

type TextareaRef = RefObject<HTMLTextAreaElement | null>;

export type UseFileMentionAutocompleteOptions = {
  workspaceId?: string;
  value: string;
  onValueChange: (value: string) => void;
  textareaRef?: TextareaRef;
  disabled?: boolean;
  limit?: number;
  debounceMs?: number;
  onSubmit?: () => void | Promise<void>;
};

export function useFileMentionAutocomplete({
  workspaceId,
  value,
  onValueChange,
  textareaRef,
  disabled = false,
  limit = 20,
  debounceMs = 220,
  onSubmit,
}: UseFileMentionAutocompleteOptions) {
  const internalTextareaRef = useRef<HTMLTextAreaElement>(null);
  const resolvedTextareaRef = textareaRef ?? internalTextareaRef;
  const listboxId = useId();
  const optionIdPrefix = `${listboxId}-option`;
  const cursorRef = useRef(value.length);
  const [mentionToken, setMentionToken] = useState(ClientSharedFileMentionService.findToken(value, value.length));
  const [debouncedMentionToken, setDebouncedMentionToken] = useState(ClientSharedFileMentionService.findToken(value, value.length));
  const [activeIndex, setActiveIndex] = useState(0);
  const debouncedTokenUpdate = useMemo(() => debounce(setDebouncedMentionToken, debounceMs), [debounceMs]);

  const updateMentionToken = useCallback((nextValue: string, cursor: number | null) => {
    const nextCursor = cursor ?? nextValue.length;
    cursorRef.current = nextCursor;
    setMentionToken(ClientSharedFileMentionService.findToken(nextValue, nextCursor));
  }, []);

  useEffect(() => {
    if (disabled) {
      setMentionToken(null);
      setDebouncedMentionToken(null);
      debouncedTokenUpdate.clear();
      return;
    }

    updateMentionToken(value, Math.min(cursorRef.current, value.length));
  }, [debouncedTokenUpdate, disabled, updateMentionToken, value]);

  useEffect(() => {
    if (!mentionToken || disabled) {
      setDebouncedMentionToken(null);
      debouncedTokenUpdate.clear();
      return;
    }

    debouncedTokenUpdate(mentionToken);

    return () => debouncedTokenUpdate.clear();
  }, [debouncedTokenUpdate, disabled, mentionToken]);

  const queryInput = debouncedMentionToken && workspaceId ? {
    workspaceId,
    query: debouncedMentionToken.query,
    limit,
  } : skipToken;

  const fileSearchQuery = trpcReact.controlPlane.workspaceFileSearch.useQuery(queryInput, {
    enabled: Boolean(workspaceId && debouncedMentionToken),
    staleTime: 10_000,
  });

  const queryIsCurrent = Boolean(
    mentionToken &&
    debouncedMentionToken &&
    mentionToken.query === debouncedMentionToken.query &&
    mentionToken.start === debouncedMentionToken.start &&
    mentionToken.end === debouncedMentionToken.end,
  );

  const suggestions = useMemo(
    () => {
      const data = fileSearchQuery.data;
      if (!queryIsCurrent || fileSearchQuery.isFetching || !data || data.workspaceId !== workspaceId) {
        return [];
      }

      return data.files;
    },
    [fileSearchQuery.data, fileSearchQuery.isFetching, queryIsCurrent, workspaceId],
  );
  const activeOptionId = mentionToken && suggestions[activeIndex] ? `${optionIdPrefix}-${activeIndex}` : undefined;
  const loading = Boolean(mentionToken) && (!queryIsCurrent || fileSearchQuery.isFetching);
  const error = queryIsCurrent && fileSearchQuery.error ? fileSearchQuery.error.message : undefined;

  useEffect(() => {
    setActiveIndex(0);
  }, [mentionToken?.query]);

  useEffect(() => {
    setActiveIndex((index) => Math.min(index, Math.max(suggestions.length - 1, 0)));
  }, [suggestions.length]);

  const close = useCallback(() => {
    setMentionToken(null);
    setDebouncedMentionToken(null);
    setActiveIndex(0);
  }, []);

  useEffect(() => {
    close();
  }, [close, workspaceId]);

  const insertMention = useCallback((suggestion: FileMentionSuggestion) => {
    if (!mentionToken || disabled) {
      return;
    }

    const inserted = ClientSharedFileMentionService.insertSelection(value, mentionToken, suggestion.path);

    onValueChange(inserted.value);
    close();
    cursorRef.current = inserted.cursor;

    window.requestAnimationFrame(() => {
      resolvedTextareaRef.current?.focus();
      resolvedTextareaRef.current?.setSelectionRange(inserted.cursor, inserted.cursor);
    });
  }, [close, disabled, mentionToken, onValueChange, resolvedTextareaRef, value]);

  const moveActiveIndex = useCallback((offset: number) => {
    setActiveIndex((index) => {
      if (!suggestions.length) {
        return 0;
      }

      return (index + offset + suggestions.length) % suggestions.length;
    });
  }, [suggestions.length]);

  const handleChange = useCallback((event: ChangeEvent<HTMLTextAreaElement>) => {
    const nextValue = event.target.value;
    onValueChange(nextValue);
    updateMentionToken(nextValue, event.target.selectionStart);
  }, [onValueChange, updateMentionToken]);

  const handleSelectionChange = useCallback((event: SyntheticEvent<HTMLTextAreaElement>) => {
    updateMentionToken(value, event.currentTarget.selectionStart);
  }, [updateMentionToken, value]);

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (disabled) {
      return false;
    }

    if (mentionToken) {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        return true;
      }

      const keyActions: Record<string, () => void> = {
        ArrowDown: () => moveActiveIndex(1),
        ArrowUp: () => moveActiveIndex(-1),
      };
      const keyAction = keyActions[event.key];

      if (keyAction && suggestions.length) {
        event.preventDefault();
        keyAction();
        return true;
      }

      if ((event.key === 'Enter' || event.key === 'Tab') && suggestions[activeIndex]) {
        event.preventDefault();
        insertMention(suggestions[activeIndex]);
        return true;
      }

      if ((event.key === 'Enter' || event.key === 'Tab') && loading) {
        event.preventDefault();
        return true;
      }
    }

    if (onSubmit && shouldSubmitFromKeyDown(event)) {
      event.preventDefault();
      void onSubmit();
      return true;
    }

    return false;
  }, [
    activeIndex,
    close,
    disabled,
    insertMention,
    loading,
    mentionToken,
    moveActiveIndex,
    onSubmit,
    suggestions,
  ]);

  return {
    textareaRef: resolvedTextareaRef,
    isOpen: Boolean(mentionToken),
    query: mentionToken?.query ?? '',
    suggestions,
    loading,
    error,
    activeIndex,
    activeOptionId,
    close,
    insertMention,
    handleChange,
    handleKeyDown,
    handleSelectionChange,
    shouldSubmitFromKeyDown,
    textareaProps: {
      'aria-activedescendant': activeOptionId,
      'aria-autocomplete': 'list' as const,
      'aria-controls': mentionToken ? listboxId : undefined,
      'aria-expanded': Boolean(mentionToken),
      onChange: handleChange,
      onClick: handleSelectionChange,
      onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => {
        handleKeyDown(event);
      },
      onSelect: handleSelectionChange,
    },
    menuProps: {
      id: listboxId,
      optionIdPrefix,
      loading,
      suggestions,
      activeIndex,
      error,
      query: mentionToken?.query ?? '',
      onPick: insertMention,
    },
  };
}

export function shouldSubmitFromKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
  return (
    event.key === 'Enter' &&
    !event.nativeEvent.isComposing &&
    !event.shiftKey &&
    !event.altKey &&
    !event.metaKey &&
    !event.ctrlKey
  );
}
