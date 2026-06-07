import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ClientSharedRecentEditDiff } from '@/client-shared/services/session-activities/index.js';
import type { PromptInputKey } from '../components/PromptInput.js';

export type RecentEditDiffReviewMode = 'summary' | 'review';

export type RecentEditDiffReviewState = {
  mode: RecentEditDiffReviewMode;
  selectedIndex: number;
  selectedDiff?: ClientSharedRecentEditDiff;
  hasDiffs: boolean;
  open: () => void;
  close: () => void;
  next: () => void;
  previous: () => void;
  handleReviewKey: (input: string, key: PromptInputKey) => boolean;
};

/**
 * Owns TUI-only diff review state.
 *
 * The control-plane API owns recent-edit diff facts. This hook owns only the
 * terminal interaction model: summary vs focused review mode and keyboard
 * navigation across already-projected diffs.
 */
export function useRecentEditDiffReview(diffs: ClientSharedRecentEditDiff[]): RecentEditDiffReviewState {
  const [mode, setMode] = useState<RecentEditDiffReviewMode>('summary');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const hasDiffs = diffs.length > 0;

  useEffect(() => {
    if (!hasDiffs) {
      setMode('summary');
      setSelectedIndex(0);
      return;
    }

    setSelectedIndex((current) => Math.min(current, diffs.length - 1));
  }, [diffs.length, hasDiffs]);

  const move = useCallback((direction: 1 | -1) => {
    setSelectedIndex((current) => {
      if (!hasDiffs) {
        return 0;
      }

      return (current + direction + diffs.length) % diffs.length;
    });
  }, [diffs.length, hasDiffs]);

  const open = useCallback(() => {
    if (!hasDiffs) {
      return;
    }

    setMode('review');
  }, [hasDiffs]);

  const close = useCallback(() => {
    setMode('summary');
  }, []);

  const next = useCallback(() => {
    move(1);
  }, [move]);

  const previous = useCallback(() => {
    move(-1);
  }, [move]);

  const handleReviewKey = useCallback((input: string, key: PromptInputKey) => {
    if (mode !== 'review') {
      return false;
    }

    if (key.escape) {
      close();
      return true;
    }

    if (key.downArrow || input === 'j' || input === 'n') {
      next();
      return true;
    }

    if (key.upArrow || input === 'k' || input === 'p') {
      previous();
      return true;
    }

    return true;
  }, [close, mode, next, previous]);

  return useMemo(() => ({
    mode,
    selectedIndex,
    selectedDiff: diffs[selectedIndex],
    hasDiffs,
    open,
    close,
    next,
    previous,
    handleReviewKey,
  }), [
    close,
    diffs,
    handleReviewKey,
    hasDiffs,
    mode,
    next,
    open,
    previous,
    selectedIndex,
  ]);
}
