import { useCallback, useRef } from 'react';

export type PromptDraftState = {
  value: string;
  cursor: number;
};

const MAX_UNDO_STATES = 100;

export function usePromptUndoRedo() {
  const undoStackRef = useRef<PromptDraftState[]>([]);
  const redoStackRef = useRef<PromptDraftState[]>([]);

  const resetUndoRedo = useCallback(() => {
    undoStackRef.current = [];
    redoStackRef.current = [];
  }, []);

  const recordUndoState = useCallback((current: PromptDraftState, next: PromptDraftState) => {
    if (isSamePromptDraftState(current, next)) {
      return;
    }

    undoStackRef.current = [...undoStackRef.current, current].slice(-MAX_UNDO_STATES);
    redoStackRef.current = [];
  }, []);

  const undoPromptEdit = useCallback((current: PromptDraftState): PromptDraftState | undefined => {
    const previous = resolvePromptUndo(undoStackRef.current, redoStackRef.current, current);
    if (!previous) {
      return undefined;
    }

    undoStackRef.current = previous.undoStack;
    redoStackRef.current = previous.redoStack;
    return previous.state;
  }, []);

  const redoPromptEdit = useCallback((current: PromptDraftState): PromptDraftState | undefined => {
    const next = resolvePromptRedo(undoStackRef.current, redoStackRef.current, current);
    if (!next) {
      return undefined;
    }

    undoStackRef.current = next.undoStack;
    redoStackRef.current = next.redoStack;
    return next.state;
  }, []);

  return {
    resetUndoRedo,
    recordUndoState,
    undoPromptEdit,
    redoPromptEdit,
  };
}

function isSamePromptDraftState(left: PromptDraftState, right: PromptDraftState): boolean {
  return left.value === right.value && left.cursor === right.cursor;
}

export function resolvePromptUndo(
  undoStack: PromptDraftState[],
  redoStack: PromptDraftState[],
  current: PromptDraftState,
): { state: PromptDraftState; undoStack: PromptDraftState[]; redoStack: PromptDraftState[] } | undefined {
  const previous = undoStack[undoStack.length - 1];
  if (!previous) {
    return undefined;
  }

  return {
    state: previous,
    undoStack: undoStack.slice(0, -1),
    redoStack: [...redoStack, current],
  };
}

export function resolvePromptRedo(
  undoStack: PromptDraftState[],
  redoStack: PromptDraftState[],
  current: PromptDraftState,
): { state: PromptDraftState; undoStack: PromptDraftState[]; redoStack: PromptDraftState[] } | undefined {
  const next = redoStack[redoStack.length - 1];
  if (!next) {
    return undefined;
  }

  return {
    state: next,
    undoStack: [...undoStack, current],
    redoStack: redoStack.slice(0, -1),
  };
}
