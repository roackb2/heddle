import React, { useEffect, useMemo, useRef } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';

const DEFAULT_MAX_VISIBLE_INPUT_LINES = 8;
const FALLBACK_WRAP_WIDTH = 80;
const PROMPT_INPUT_PREFIX_WIDTH = 2;

export type PromptKeyInput = {
  input: string;
  key: {
    return?: boolean;
    backspace?: boolean;
    delete?: boolean;
    leftArrow?: boolean;
    rightArrow?: boolean;
    upArrow?: boolean;
    downArrow?: boolean;
    home?: boolean;
    end?: boolean;
    tab?: boolean;
    escape?: boolean;
    ctrl?: boolean;
    meta?: boolean;
    shift?: boolean;
  };
};

export function PromptInput({
  value,
  isDisabled,
  placeholder,
  width,
  promptHistory = [],
  maxVisibleLines = DEFAULT_MAX_VISIBLE_INPUT_LINES,
  cursor,
  onChange,
  onCursorChange,
  onSubmit,
  onSpecialKey,
}: {
  value: string;
  isDisabled: boolean;
  placeholder: string;
  width?: number;
  promptHistory?: string[];
  maxVisibleLines?: number;
  cursor: number;
  onChange: (value: string) => void;
  onCursorChange: (cursor: number) => void;
  onSubmit: (value: string) => void;
  onSpecialKey?: (event: PromptKeyInput) => boolean;
}) {
  const valueRef = useRef(value);
  const cursorRef = useRef(cursor);
  const undoStackRef = useRef<PromptDraftState[]>([]);
  const redoStackRef = useRef<PromptDraftState[]>([]);
  const promptHistoryRef = useRef(promptHistory);
  const promptHistoryIndexRef = useRef<number | undefined>(undefined);
  const savedDraftBeforeHistoryRef = useRef<PromptDraftState | undefined>(undefined);
  const { stdout } = useStdout();
  const renderWidth = resolvePromptInputRenderWidth(width, stdout.columns);

  useEffect(() => {
    if (valueRef.current !== value) {
      undoStackRef.current = [];
      redoStackRef.current = [];
      promptHistoryIndexRef.current = undefined;
      savedDraftBeforeHistoryRef.current = undefined;
    }
    valueRef.current = value;
  }, [value]);

  useEffect(() => {
    cursorRef.current = cursor;
  }, [cursor]);

  useEffect(() => {
    promptHistoryRef.current = promptHistory;
  }, [promptHistory]);

  const applyDraft = (nextValue: string, nextCursor: number, options: { recordUndo?: boolean } = {}) => {
    const current = {
      value: valueRef.current,
      cursor: Math.min(cursorRef.current, valueRef.current.length),
    };
    const next = { value: nextValue, cursor: nextCursor };
    if (options.recordUndo !== false && !isSamePromptDraftState(current, next)) {
      undoStackRef.current = [...undoStackRef.current, current].slice(-100);
      redoStackRef.current = [];
      promptHistoryIndexRef.current = undefined;
      savedDraftBeforeHistoryRef.current = undefined;
    }

    valueRef.current = nextValue;
    cursorRef.current = nextCursor;
    onChange(nextValue);
    onCursorChange(nextCursor);
  };

  useInput((input, key) => {
    if (isDisabled) {
      return;
    }

    const state = {
      value: valueRef.current,
      cursor: Math.min(cursorRef.current, valueRef.current.length),
    };
    const applyState = (nextState: PromptDraftState, options?: { recordUndo?: boolean }) =>
      applyDraft(nextState.value, nextState.cursor, options);
    const actions: PromptInputActions = {
      applyDraft: applyState,
      moveCursor: (nextCursor) => {
        cursorRef.current = nextCursor;
        onCursorChange(nextCursor);
      },
      onSubmit,
      undo: () => {
        const previous = resolvePromptUndo(undoStackRef.current, redoStackRef.current, state);
        if (!previous) {
          return;
        }
        undoStackRef.current = previous.undoStack;
        redoStackRef.current = previous.redoStack;
        applyState(previous.state, { recordUndo: false });
      },
      redo: () => {
        const next = resolvePromptRedo(undoStackRef.current, redoStackRef.current, state);
        if (!next) {
          return;
        }
        undoStackRef.current = next.undoStack;
        redoStackRef.current = next.redoStack;
        applyState(next.state, { recordUndo: false });
      },
      navigateHistory: (direction) => {
        const next = resolvePromptHistoryNavigation({
          direction,
          history: promptHistoryRef.current,
          current: state,
          historyIndex: promptHistoryIndexRef.current,
          savedDraftBeforeHistory: savedDraftBeforeHistoryRef.current,
        });
        if (!next) {
          return;
        }

        promptHistoryIndexRef.current = next.historyIndex;
        savedDraftBeforeHistoryRef.current = next.savedDraftBeforeHistory;
        applyState(next.state, { recordUndo: false });
      },
    };

    if (onSpecialKey?.({ input, key })) {
      return;
    }

    const command = resolvePromptInputCommand(input, key);
    if (!command) {
      return;
    }

    handlePromptInputCommand(command, state, actions);
  }, { isActive: !isDisabled });

  const lines = useMemo(
    () => buildPromptRenderLines(value, cursor, maxVisibleLines, renderWidth),
    [value, cursor, maxVisibleLines, renderWidth],
  );

  if (!value) {
    return (
      <Box flexGrow={1} paddingX={0} paddingY={0}>
        <Text color="cyan">{'› '}</Text>
        <Text dimColor>{placeholder}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={0} paddingY={0}>
      {lines.map((line, index) => (
        <Box key={`${index}-${line.before}-${line.cursor}-${line.after}-${line.hasCursor}`}>
          <Text color="cyan">{index === 0 ? '› ' : '  '}</Text>
          <Text>
            {line.hasCursor ?
              <>
                {line.before}
                <Text inverse>{line.cursor}</Text>
                {line.after}
              </>
            : (line.before || ' ')}
          </Text>
        </Box>
      ))}
    </Box>
  );
}

export function resolvePromptInputRenderWidth(width?: number, stdoutColumns?: number): number {
  const candidate = width ?? stdoutColumns ?? FALLBACK_WRAP_WIDTH;
  return Math.max(PROMPT_INPUT_PREFIX_WIDTH + 1, Math.floor(candidate));
}

export type PromptDraftState = {
  value: string;
  cursor: number;
};

type PromptInputCommand =
  | { kind: 'submit' }
  | { kind: 'insert'; input: string }
  | { kind: 'undo' }
  | { kind: 'redo' }
  | { kind: 'history'; direction: 'previous' | 'next' }
  | { kind: 'deletePreviousChar' }
  | { kind: 'deletePreviousWord' }
  | { kind: 'deleteBeforeCursor' }
  | { kind: 'deleteAfterCursor' }
  | { kind: 'move'; direction: 'start' | 'end' | 'previousChar' | 'nextChar' | 'previousWord' | 'nextWord' };

type PromptInputActions = {
  applyDraft: (state: PromptDraftState, options?: { recordUndo?: boolean }) => void;
  moveCursor: (cursor: number) => void;
  onSubmit: (value: string) => void;
  undo: () => void;
  redo: () => void;
  navigateHistory: (direction: 'previous' | 'next') => void;
};

const CTRL_COMMANDS = new Map<string, PromptInputCommand>([
  ['a', { kind: 'move', direction: 'start' }],
  ['e', { kind: 'move', direction: 'end' }],
  ['k', { kind: 'deleteAfterCursor' }],
  ['u', { kind: 'deleteBeforeCursor' }],
  ['w', { kind: 'deletePreviousWord' }],
  ['y', { kind: 'redo' }],
  ['z', { kind: 'undo' }],
]);

const META_TEXT_COMMANDS = new Map<string, PromptInputCommand>([
  ['b', { kind: 'move', direction: 'previousWord' }],
  ['f', { kind: 'move', direction: 'nextWord' }],
]);

export function insertPromptText(state: PromptDraftState, input: string): PromptDraftState {
  return {
    value: insertAtCursor(state.value, state.cursor, input),
    cursor: state.cursor + input.length,
  };
}

function resolvePromptInputCommand(input: string, key: PromptKeyInput['key']): PromptInputCommand | undefined {
  if (key.return) {
    return key.shift ? { kind: 'insert', input: '\n' } : { kind: 'submit' };
  }

  if (key.ctrl && input) {
    return CTRL_COMMANDS.get(input);
  }

  if (key.meta && input) {
    return META_TEXT_COMMANDS.get(input);
  }

  if (key.meta && key.backspace) {
    return { kind: 'deletePreviousWord' };
  }

  if (key.backspace || key.delete) {
    return { kind: 'deletePreviousChar' };
  }

  if (key.meta && key.leftArrow) {
    return { kind: 'move', direction: 'previousWord' };
  }

  if (key.meta && key.rightArrow) {
    return { kind: 'move', direction: 'nextWord' };
  }

  if (key.leftArrow) {
    return { kind: 'move', direction: 'previousChar' };
  }

  if (key.rightArrow) {
    return { kind: 'move', direction: 'nextChar' };
  }

  if (key.upArrow) {
    return { kind: 'history', direction: 'previous' };
  }

  if (key.downArrow) {
    return { kind: 'history', direction: 'next' };
  }

  if (key.home) {
    return { kind: 'move', direction: 'start' };
  }

  if (key.end) {
    return { kind: 'move', direction: 'end' };
  }

  if (key.ctrl || key.meta || key.escape || key.tab || !input) {
    return undefined;
  }

  return { kind: 'insert', input };
}

function handlePromptInputCommand(
  command: PromptInputCommand,
  state: PromptDraftState,
  actions: PromptInputActions,
): void {
  switch (command.kind) {
    case 'submit':
      actions.onSubmit(state.value);
      return;
    case 'insert':
      actions.applyDraft(insertPromptText(state, command.input));
      return;
    case 'undo':
      actions.undo();
      return;
    case 'redo':
      actions.redo();
      return;
    case 'history':
      if (canNavigatePromptHistory(command.direction, state)) {
        actions.navigateHistory(command.direction);
      }
      return;
    case 'deletePreviousChar':
      if (state.cursor > 0) {
        actions.applyDraft({ value: removeRange(state.value, state.cursor - 1, state.cursor), cursor: state.cursor - 1 });
      }
      return;
    case 'deletePreviousWord': {
      const nextCursor = findPreviousWordBoundary(state.value, state.cursor);
      actions.applyDraft({ value: removeRange(state.value, nextCursor, state.cursor), cursor: nextCursor });
      return;
    }
    case 'deleteBeforeCursor':
      actions.applyDraft({ value: state.value.slice(state.cursor), cursor: 0 });
      return;
    case 'deleteAfterCursor':
      actions.applyDraft({ value: state.value.slice(0, state.cursor), cursor: state.cursor });
      return;
    case 'move':
      actions.moveCursor(resolvePromptCursorMove(state, command.direction));
  }
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

export function canNavigatePromptHistory(direction: 'previous' | 'next', state: PromptDraftState): boolean {
  if (!state.value.includes('\n')) {
    return true;
  }

  if (direction === 'previous') {
    const firstLineEnd = state.value.indexOf('\n');
    return state.cursor <= firstLineEnd;
  }

  const lastLineStart = state.value.lastIndexOf('\n') + 1;
  return state.cursor >= lastLineStart;
}

export function resolvePromptHistoryNavigation(args: {
  direction: 'previous' | 'next';
  history: string[];
  current: PromptDraftState;
  historyIndex?: number;
  savedDraftBeforeHistory?: PromptDraftState;
}): { state: PromptDraftState; historyIndex?: number; savedDraftBeforeHistory?: PromptDraftState } | undefined {
  if (args.history.length === 0) {
    return undefined;
  }

  if (args.direction === 'previous') {
    const historyIndex =
      args.historyIndex === undefined ?
        args.history.length - 1
      : Math.max(0, args.historyIndex - 1);
    const value = args.history[historyIndex] ?? '';
    return {
      state: { value, cursor: value.length },
      historyIndex,
      savedDraftBeforeHistory: args.savedDraftBeforeHistory ?? args.current,
    };
  }

  if (args.historyIndex === undefined) {
    return undefined;
  }

  if (args.historyIndex < args.history.length - 1) {
    const historyIndex = args.historyIndex + 1;
    const value = args.history[historyIndex] ?? '';
    return {
      state: { value, cursor: value.length },
      historyIndex,
      savedDraftBeforeHistory: args.savedDraftBeforeHistory,
    };
  }

  return {
    state: args.savedDraftBeforeHistory ?? { value: '', cursor: 0 },
    historyIndex: undefined,
    savedDraftBeforeHistory: undefined,
  };
}

function resolvePromptCursorMove(state: PromptDraftState, direction: Extract<PromptInputCommand, { kind: 'move' }>['direction']): number {
  switch (direction) {
    case 'start':
      return 0;
    case 'end':
      return state.value.length;
    case 'previousChar':
      return Math.max(0, state.cursor - 1);
    case 'nextChar':
      return Math.min(state.value.length, state.cursor + 1);
    case 'previousWord':
      return findPreviousWordBoundary(state.value, state.cursor);
    case 'nextWord':
      return findNextWordBoundary(state.value, state.cursor);
  }
}

export type PromptRenderLine = {
  before: string;
  cursor: string;
  after: string;
  hasCursor: boolean;
};

export function buildPromptRenderLines(
  value: string,
  cursor: number,
  maxVisibleLines: number,
  width = FALLBACK_WRAP_WIDTH,
): PromptRenderLine[] {
  const rawLines = value.split('\n');
  const rendered: PromptRenderLine[] = [];
  const contentWidth = Math.max(1, width - PROMPT_INPUT_PREFIX_WIDTH);
  let logicalOffset = 0;

  for (let lineIndex = 0; lineIndex < rawLines.length; lineIndex += 1) {
    const line = rawLines[lineIndex] ?? '';
    const wrapped = wrapLine(line, contentWidth);
    const lineStart = logicalOffset;
    const lineEnd = lineStart + line.length;
    const isLastLogicalLine = lineIndex === rawLines.length - 1;
    let segmentStart = lineStart;

    for (let segmentIndex = 0; segmentIndex < wrapped.length; segmentIndex += 1) {
      const segment = wrapped[segmentIndex] ?? '';
      const segmentEnd = segmentStart + segment.length;
      const isLastWrappedSegment = segmentIndex === wrapped.length - 1;
      const hasCursor =
        cursor >= segmentStart &&
        (
          cursor < segmentEnd ||
          (segment.length === 0 && cursor === segmentStart) ||
          (isLastWrappedSegment && isLastLogicalLine && cursor === lineEnd)
        );

      if (hasCursor) {
        const cursorOffset = cursor - segmentStart;
        rendered.push({
          before: segment.slice(0, cursorOffset),
          cursor: segment[cursorOffset] ?? ' ',
          after: segment.slice(cursorOffset + 1),
          hasCursor: true,
        });
      } else {
        rendered.push({
          before: segment,
          cursor: '',
          after: '',
          hasCursor: false,
        });
      }

      segmentStart = segmentEnd;
    }

    logicalOffset = lineEnd + 1;
  }

  if (rendered.length <= maxVisibleLines) {
    return rendered;
  }

  return rendered.slice(rendered.length - maxVisibleLines);
}

function wrapLine(line: string, width: number): string[] {
  if (line.length === 0) {
    return [''];
  }

  const segments: string[] = [];
  for (let start = 0; start < line.length; start += width) {
    segments.push(line.slice(start, start + width));
  }
  return segments;
}

function insertAtCursor(value: string, cursor: number, input: string): string {
  return `${value.slice(0, cursor)}${input}${value.slice(cursor)}`;
}

function removeRange(value: string, start: number, end: number): string {
  return `${value.slice(0, start)}${value.slice(end)}`;
}

function findPreviousWordBoundary(value: string, cursor: number): number {
  let index = cursor;

  while (index > 0 && isWordBoundary(value[index - 1])) {
    index--;
  }

  while (index > 0 && !isWordBoundary(value[index - 1])) {
    index--;
  }

  return index;
}

function findNextWordBoundary(value: string, cursor: number): number {
  let index = cursor;

  while (index < value.length && isWordBoundary(value[index])) {
    index++;
  }

  while (index < value.length && !isWordBoundary(value[index])) {
    index++;
  }

  return index;
}

function isWordBoundary(char: string | undefined): boolean {
  return !char || /\s|[.,/#!$%^&*;:{}=\-_`~()\[\]"'<>?\\|]/.test(char);
}
