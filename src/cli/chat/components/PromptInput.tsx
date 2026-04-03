import React, { useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';

const DEFAULT_MAX_VISIBLE_INPUT_LINES = 8;
const FALLBACK_WRAP_WIDTH = 80;
const CURSOR_GLYPH = '▌';

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
  onChange,
  onSubmit,
  onSpecialKey,
}: {
  value: string;
  isDisabled: boolean;
  placeholder: string;
  maxVisibleLines?: number;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  onSpecialKey?: (event: PromptKeyInput) => boolean;
}) {
  const [cursor, setCursor] = useState(value.length);

  useInput((input, key) => {
    if (isDisabled) {
      return;
    }

    if (onSpecialKey?.({ input, key })) {
      return;
    }

    if (key.return && !key.shift) {
      onSubmit(value);
      setCursor(0);
      return;
    }

    if (key.return && key.shift) {
      onChange(insertAtCursor(value, cursor, '\n'));
      setCursor(cursor + 1);
      return;
    }

    if (key.meta && key.backspace) {
      const nextCursor = findPreviousWordBoundary(value, cursor);
      onChange(removeRange(value, nextCursor, cursor));
      setCursor(nextCursor);
      return;
    }

    if (key.ctrl && input === 'u') {
      onChange(value.slice(cursor));
      setCursor(0);
      return;
    }

    if (key.ctrl && input === 'k') {
      onChange(value.slice(0, cursor));
      return;
    }

    if (key.ctrl && input === 'a') {
      setCursor(0);
      return;
    }

    if (key.ctrl && input === 'e') {
      setCursor(value.length);
      return;
    }

    if (key.ctrl && input === 'w') {
      const nextCursor = findPreviousWordBoundary(value, cursor);
      onChange(removeRange(value, nextCursor, cursor));
      setCursor(nextCursor);
      return;
    }

    if (key.backspace || key.delete) {
      if (cursor === 0) {
        return;
      }

      onChange(removeRange(value, cursor - 1, cursor));
      setCursor(cursor - 1);
      return;
    }

    if (key.leftArrow) {
      setCursor(Math.max(0, cursor - 1));
      return;
    }

    if (key.rightArrow) {
      setCursor(Math.min(value.length, cursor + 1));
      return;
    }

    if (key.home) {
      setCursor(0);
      return;
    }

    if (key.end) {
      setCursor(value.length);
      return;
    }

    if (key.ctrl || key.meta || key.escape || key.tab) {
      return;
    }

    if (!input) {
      return;
    }

    onChange(insertAtCursor(value, cursor, input));
    setCursor(cursor + input.length);
  }, { isActive: !isDisabled });

  const lines = useMemo(() => buildPromptLines(value, cursor, maxVisibleLines), [value, cursor, maxVisibleLines]);

  if (!value) {
    return <Text dimColor>{placeholder}</Text>;
  }

  return (
    <Box flexDirection="column">
      {lines.map((line, index) => (
        <Text key={`${index}-${line}`}>{line || ' '}</Text>
      ))}
    </Box>
  );
}

function buildPromptLines(value: string, cursor: number, maxVisibleLines: number): string[] {
  const withCursor = `${value.slice(0, cursor)}${CURSOR_GLYPH}${value.slice(cursor)}`;
  const rawLines = withCursor.split('\n');
  const wrapped = rawLines.flatMap((line) => wrapLine(line, FALLBACK_WRAP_WIDTH));
  if (wrapped.length <= maxVisibleLines) {
    return wrapped;
  }

  return wrapped.slice(wrapped.length - maxVisibleLines);
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

function isWordBoundary(char: string | undefined): boolean {
  return !char || /\s|[.,/#!$%^&*;:{}=\-_`~()\[\]"'<>?\\|]/.test(char);
}
