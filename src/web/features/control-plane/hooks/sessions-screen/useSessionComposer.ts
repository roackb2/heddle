import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import {
  fetchWorkspaceFileSuggestions,
  type WorkspaceFileSuggestion,
} from '../../../../lib/api';

type FileMentionQuery = {
  query: string;
  start: number;
  end: number;
};

export function useSessionComposer({
  onSendPrompt,
}: {
  onSendPrompt: (prompt: string) => Promise<void>;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState('');
  const [mentionQuery, setMentionQuery] = useState<FileMentionQuery | null>(null);
  const [mentionSuggestions, setMentionSuggestions] = useState<WorkspaceFileSuggestion[]>([]);
  const [mentionLoading, setMentionLoading] = useState(false);
  const [mentionError, setMentionError] = useState<string | undefined>();
  const [activeMentionIndex, setActiveMentionIndex] = useState(0);

  useEffect(() => {
    if (!mentionQuery) {
      setMentionSuggestions([]);
      setMentionLoading(false);
      setMentionError(undefined);
      setActiveMentionIndex(0);
      return;
    }

    let cancelled = false;
    setMentionLoading(true);
    const timeout = window.setTimeout(() => {
      void fetchWorkspaceFileSuggestions(mentionQuery.query)
        .then((files) => {
          if (!cancelled) {
            setMentionSuggestions(files);
            setMentionError(undefined);
            setActiveMentionIndex(0);
          }
        })
        .catch((error) => {
          if (!cancelled) {
            setMentionSuggestions([]);
            setMentionError(error instanceof Error ? error.message : String(error));
          }
        })
        .finally(() => {
          if (!cancelled) {
            setMentionLoading(false);
          }
        });
    }, 220);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [mentionQuery]);

  const updateDraft = (value: string, cursor: number | null) => {
    setDraft(value);
    setMentionQuery(findFileMentionQuery(value, cursor ?? value.length));
  };

  const insertMention = (suggestion: WorkspaceFileSuggestion) => {
    if (!mentionQuery) {
      return;
    }

    const nextDraft = `${draft.slice(0, mentionQuery.start)}@${suggestion.path} ${draft.slice(mentionQuery.end)}`;
    const nextCursor = mentionQuery.start + suggestion.path.length + 2;
    setDraft(nextDraft);
    setMentionQuery(null);
    setMentionSuggestions([]);
    window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(nextCursor, nextCursor);
    });
  };

  const submitDraft = () => {
    const prompt = draft.trim();
    if (!prompt) {
      return;
    }
    setDraft('');
    void onSendPrompt(prompt);
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionQuery && (mentionSuggestions.length || mentionLoading)) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveMentionIndex((index) => Math.min(index + 1, Math.max(mentionSuggestions.length - 1, 0)));
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveMentionIndex((index) => Math.max(index - 1, 0));
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setMentionQuery(null);
        setMentionSuggestions([]);
        return;
      }
      if ((event.key === 'Enter' || event.key === 'Tab') && mentionSuggestions[activeMentionIndex]) {
        event.preventDefault();
        insertMention(mentionSuggestions[activeMentionIndex]);
        return;
      }
    }

    if (event.key !== 'Enter' || event.nativeEvent.isComposing) {
      return;
    }

    if (typeof window !== 'undefined' && window.innerWidth <= 760) {
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        submitDraft();
      }
      return;
    }

    if (!event.shiftKey && !event.altKey) {
      event.preventDefault();
      submitDraft();
    }
  };

  return {
    textareaRef,
    draft,
    mentionQuery,
    mentionSuggestions,
    mentionLoading,
    mentionError,
    activeMentionIndex,
    updateDraft,
    insertMention,
    submitDraft,
    handleComposerKeyDown,
  };
}

function findFileMentionQuery(value: string, cursor: number): FileMentionQuery | null {
  const beforeCursor = value.slice(0, cursor);
  const match = beforeCursor.match(/(^|\s)@([^\s@]*)$/);
  if (!match || match.index === undefined) {
    return null;
  }

  const prefix = match[1] ?? '';
  const query = match[2] ?? '';
  const start = match.index + prefix.length;
  return {
    query,
    start,
    end: cursor,
  };
}
