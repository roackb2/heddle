import { useCallback, useRef, useState } from 'react';

type PromptSnapshot = {
  value: string;
  cursor: number;
};

function snapshotsEqual(left: PromptSnapshot, right: PromptSnapshot): boolean {
  return left.value === right.value && left.cursor === right.cursor;
}

export function usePromptDraft() {
  const [draft, setDraftState] = useState('');
  const [draftCursor, setDraftCursorState] = useState(0);
  const [historyIndex, setHistoryIndex] = useState<number | undefined>(undefined);
  const undoStackRef = useRef<PromptSnapshot[]>([]);
  const redoStackRef = useRef<PromptSnapshot[]>([]);
  const snapshotRef = useRef<PromptSnapshot>({ value: '', cursor: 0 });

  const commitSnapshot = useCallback((next: PromptSnapshot, options?: { skipUndo?: boolean }) => {
    const previous = snapshotRef.current;
    if (!options?.skipUndo && !snapshotsEqual(previous, next)) {
      undoStackRef.current.push(previous);
      redoStackRef.current = [];
    }

    snapshotRef.current = next;
    setDraftState(next.value);
    setDraftCursorState(next.cursor);
  }, []);

  const setDraft = useCallback((value: string) => {
    commitSnapshot({ value, cursor: Math.min(snapshotRef.current.cursor, value.length) });
  }, [commitSnapshot]);

  const setDraftCursor = useCallback((cursor: number) => {
    const next = { value: snapshotRef.current.value, cursor: Math.min(Math.max(0, cursor), snapshotRef.current.value.length) };
    snapshotRef.current = next;
    setDraftCursorState(next.cursor);
  }, []);

  const clearDraft = useCallback(() => {
    commitSnapshot({ value: '', cursor: 0 });
    setHistoryIndex(undefined);
  }, [commitSnapshot]);

  const replaceDraft = useCallback((value: string) => {
    commitSnapshot({ value, cursor: value.length });
    setHistoryIndex(undefined);
  }, [commitSnapshot]);

  const undoDraft = useCallback(() => {
    const previous = undoStackRef.current.pop();
    if (!previous) {
      return false;
    }

    redoStackRef.current.push(snapshotRef.current);
    commitSnapshot(previous, { skipUndo: true });
    setHistoryIndex(undefined);
    return true;
  }, [commitSnapshot]);

  const redoDraft = useCallback(() => {
    const next = redoStackRef.current.pop();
    if (!next) {
      return false;
    }

    undoStackRef.current.push(snapshotRef.current);
    commitSnapshot(next, { skipUndo: true });
    setHistoryIndex(undefined);
    return true;
  }, [commitSnapshot]);

  return {
    draft,
    setDraft,
    draftCursor,
    setDraftCursor,
    clearDraft,
    replaceDraft,
    undoDraft,
    redoDraft,
    historyIndex,
    setHistoryIndex,
  };
}
