import React, { useState } from 'react';
import { Text, useInput } from 'ink';

const MAX_VISIBLE_INPUT_CHARS = 96;

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
  };
};

export function PromptInput({
  value,
  isDisabled,
  placeholder,
  onChange,
  onSubmit,
  onSpecialKey,
}: {
  value: string;
  isDisabled: boolean;
  placeholder: string;
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

    if (key.return) {
      onSubmit(value);
      setCursor(0);
      return;
    }

    if ((key.meta && key.backspace) || (key.ctrl && input === 'u')) {
      onChange(value.slice(cursor));
      setCursor(0);
      return;
    }

    if (key.backspace || key.delete) {
      if (cursor === 0) {
        return;
      }

      onChange(value.slice(0, cursor - 1) + value.slice(cursor));
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

    const nextInput = normalizePastedInput(input);
    onChange(value.slice(0, cursor) + nextInput + value.slice(cursor));
    setCursor(cursor + nextInput.length);
  }, { isActive: !isDisabled });

  if (!value) {
    return <Text dimColor>{placeholder}</Text>;
  }

  return <Text>{buildPromptViewport(value, cursor)}</Text>;
}

function normalizePastedInput(input: string): string {
  return input.replace(/\r?\n+/g, ' ');
}

function buildPromptViewport(value: string, cursor: number): string {
  const withCursor = `${value.slice(0, cursor)}|${value.slice(cursor)}`;
  if (withCursor.length <= MAX_VISIBLE_INPUT_CHARS) {
    return withCursor;
  }

  const targetCursor = cursor + 1;
  const half = Math.floor(MAX_VISIBLE_INPUT_CHARS / 2);
  let start = Math.max(0, targetCursor - half);
  const maxEnd = withCursor.length;
  let end = Math.min(maxEnd, start + MAX_VISIBLE_INPUT_CHARS);
  if (end - start < MAX_VISIBLE_INPUT_CHARS) {
    start = Math.max(0, end - MAX_VISIBLE_INPUT_CHARS);
  }

  const prefix = start > 0 ? '…' : '';
  const suffix = end < withCursor.length ? '…' : '';
  const slice = withCursor.slice(start, end);
  return `${prefix}${slice}${suffix}`;
}
