import React, { useEffect, useMemo, useRef } from 'react';
import { Box, Text, useInput } from 'ink';

const DEFAULT_MAX_VISIBLE_INPUT_LINES = 8;
const FALLBACK_WRAP_WIDTH = 80;

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
  maxVisibleLines?: number;
  cursor: number;
  onChange: (value: string) => void;
  onCursorChange: (cursor: number) => void;
  onSubmit: (value: string) => void;
  onSpecialKey?: (event: PromptKeyInput) => boolean;
}) {
  const valueRef = useRef(value);
  const cursorRef = useRef(cursor);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(() => {
    cursorRef.current = cursor;
  }, [cursor]);

  const applyDraft = (nextValue: string, nextCursor: number) => {
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
    const actions: PromptInputActions = {
      applyDraft,
      moveCursor: (nextCursor) => {
        cursorRef.current = nextCursor;
        onCursorChange(nextCursor);
      },
      onSubmit,
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

  const lines = useMemo(() => buildPromptRenderLines(value, cursor, maxVisibleLines), [value, cursor, maxVisibleLines]);

  if (!value) {
    return <Text dimColor>{placeholder}</Text>;
  }

  return (
    <Box flexDirection="column">
      {lines.map((line, index) => (
        <Text key={`${index}-${line.before}-${line.cursor}-${line.after}-${line.hasCursor}`}>
          {line.hasCursor ?
            <>
              {line.before}
              <Text inverse>{line.cursor}</Text>
              {line.after}
            </>
          : (line.before || ' ')}
        </Text>
      ))}
    </Box>
  );
}

export type PromptDraftState = {
  value: string;
  cursor: number;
};

type PromptInputCommand =
  | { kind: 'submit' }
  | { kind: 'insert'; input: string }
  | { kind: 'deletePreviousChar' }
  | { kind: 'deletePreviousWord' }
  | { kind: 'deleteBeforeCursor' }
  | { kind: 'deleteAfterCursor' }
  | { kind: 'move'; direction: 'start' | 'end' | 'previousChar' | 'nextChar' | 'previousWord' | 'nextWord' };

type PromptInputActions = {
  applyDraft: (value: string, cursor: number) => void;
  moveCursor: (cursor: number) => void;
  onSubmit: (value: string) => void;
};

const CTRL_COMMANDS = new Map<string, PromptInputCommand>([
  ['a', { kind: 'move', direction: 'start' }],
  ['e', { kind: 'move', direction: 'end' }],
  ['k', { kind: 'deleteAfterCursor' }],
  ['u', { kind: 'deleteBeforeCursor' }],
  ['w', { kind: 'deletePreviousWord' }],
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
  const applyState = (next: PromptDraftState) => actions.applyDraft(next.value, next.cursor);

  switch (command.kind) {
    case 'submit':
      actions.onSubmit(state.value);
      return;
    case 'insert':
      applyState(insertPromptText(state, command.input));
      return;
    case 'deletePreviousChar':
      if (state.cursor > 0) {
        applyState({ value: removeRange(state.value, state.cursor - 1, state.cursor), cursor: state.cursor - 1 });
      }
      return;
    case 'deletePreviousWord': {
      const nextCursor = findPreviousWordBoundary(state.value, state.cursor);
      applyState({ value: removeRange(state.value, nextCursor, state.cursor), cursor: nextCursor });
      return;
    }
    case 'deleteBeforeCursor':
      applyState({ value: state.value.slice(state.cursor), cursor: 0 });
      return;
    case 'deleteAfterCursor':
      applyState({ value: state.value.slice(0, state.cursor), cursor: state.cursor });
      return;
    case 'move':
      actions.moveCursor(resolvePromptCursorMove(state, command.direction));
  }
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
  let logicalOffset = 0;

  for (let lineIndex = 0; lineIndex < rawLines.length; lineIndex += 1) {
    const line = rawLines[lineIndex] ?? '';
    const wrapped = wrapLine(line, width);
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
