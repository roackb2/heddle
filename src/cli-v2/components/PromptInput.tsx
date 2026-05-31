import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import { ClientSharedPromptInputService } from '@/client-shared/services/prompt-input/index.js';
import type {
  ClientSharedPromptDraftState,
  ClientSharedPromptHistoryDirection,
} from '@/client-shared/services/prompt-input/index.js';
import { CliV2PromptLineEditorService } from '../services/prompt-input/index.js';

const PROMPT_PREFIX_WIDTH = 2;
const FALLBACK_RENDER_WIDTH = 80;
const MAX_VISIBLE_INPUT_LINES = 6;

export type PromptInputKey = {
  upArrow?: boolean;
  downArrow?: boolean;
  leftArrow?: boolean;
  rightArrow?: boolean;
  home?: boolean;
  end?: boolean;
  return?: boolean;
  escape?: boolean;
  tab?: boolean;
  backspace?: boolean;
  delete?: boolean;
  ctrl?: boolean;
  meta?: boolean;
  super?: boolean;
  shift?: boolean;
};

export function PromptInput({
  disabled,
  placeholder,
  submitDisabled,
  value,
  cursor,
  onChange,
  onSubmit,
  onComplete,
  onHistory,
  onSpecialKey,
}: {
  disabled: boolean;
  placeholder: string;
  submitDisabled?: boolean;
  value: string;
  cursor: number;
  onChange: (state: ClientSharedPromptDraftState) => void;
  onSubmit: (value: string) => void;
  onComplete?: (value: string) => string | undefined;
  onHistory?: (direction: ClientSharedPromptHistoryDirection) => void;
  onSpecialKey?: (input: string, key: PromptInputKey) => boolean;
}) {
  const { stdout } = useStdout();
  const separator = repeatSeparator((stdout.columns ?? 0) - 2);
  const valueRef = useRef(value);
  const cursorRef = useRef(cursor);
  const renderWidth = resolvePromptInputRenderWidth(stdout.columns);
  const lines = useMemo(
    () => buildPromptRenderLines(value, cursor, MAX_VISIBLE_INPUT_LINES, renderWidth),
    [cursor, renderWidth, value],
  );

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(() => {
    cursorRef.current = ClientSharedPromptInputService.clampCursor(valueRef.current, cursor);
  }, [cursor]);

  const applyState = useCallback((nextState: ClientSharedPromptDraftState) => {
    const normalized = {
      value: nextState.value,
      cursor: ClientSharedPromptInputService.clampCursor(nextState.value, nextState.cursor),
    };
    valueRef.current = normalized.value;
    cursorRef.current = normalized.cursor;
    onChange(normalized);
  }, [onChange]);

  useInput((input, key) => {
    if (disabled) {
      return;
    }

    if (onSpecialKey?.(input, key)) {
      return;
    }

    if (key.tab) {
      const completed = onComplete?.(valueRef.current);
      if (completed !== undefined) {
        applyState({ value: completed, cursor: completed.length });
      }
      return;
    }

    const command = CliV2PromptLineEditorService.resolveCommand(input, key);
    if (!command) {
      return;
    }

    if (command.kind === 'submit') {
      if (!submitDisabled) {
        onSubmit(valueRef.current);
      }
      return;
    }

    const current = {
      value: valueRef.current,
      cursor: ClientSharedPromptInputService.clampCursor(valueRef.current, cursorRef.current),
    };

    if (command.kind === 'history') {
      if (ClientSharedPromptInputService.canNavigateHistory(command.direction, current)) {
        onHistory?.(command.direction);
      }
      return;
    }

    applyState(CliV2PromptLineEditorService.applyCommand(command, current));
  }, { isActive: !disabled });

  return (
    <Box flexDirection="column" marginTop={1} marginBottom={1}>
      <Box overflow="hidden">
        <Text dimColor wrap="truncate-end">{separator}</Text>
      </Box>
      {value ? (
        lines.map((line, index) => (
          <Box key={`${index}-${line.before}-${line.cursor}-${line.after}-${line.hasCursor}`}>
            <Text color="cyan">{index === 0 ? '› ' : '  '}</Text>
            <Text>
              {line.hasCursor ? (
                <>
                  {line.before}
                  <Text inverse>{line.cursor}</Text>
                  {line.after}
                </>
              ) : (line.before || ' ')}
            </Text>
          </Box>
        ))
      ) : (
        <Box>
          <Text color="cyan">› </Text>
          <Text dimColor>{placeholder}</Text>
        </Box>
      )}
      <Box overflow="hidden">
        <Text dimColor wrap="truncate-end">{separator}</Text>
      </Box>
    </Box>
  );
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
  width = FALLBACK_RENDER_WIDTH,
): PromptRenderLine[] {
  const rawLines = value.split('\n');
  const rendered: PromptRenderLine[] = [];
  const contentWidth = Math.max(1, width - PROMPT_PREFIX_WIDTH);
  let logicalOffset = 0;

  for (let lineIndex = 0; lineIndex < rawLines.length; lineIndex += 1) {
    const line = rawLines[lineIndex] ?? '';
    const wrapped = wrapLine(line, contentWidth);
    const lineStart = logicalOffset;
    const lineEnd = lineStart + line.length;
    const isLastLogicalLine = lineIndex === rawLines.length - 1;
    let segmentStart = lineStart;

    for (const segment of wrapped) {
      const segmentEnd = segmentStart + segment.length;
      const isLastWrappedSegment = segmentEnd === lineEnd;
      const hasCursor = cursor >= segmentStart && (
        cursor < segmentEnd ||
        (segment.length === 0 && cursor === segmentStart) ||
        (isLastWrappedSegment && isLastLogicalLine && cursor === lineEnd)
      );

      rendered.push(hasCursor ? {
        before: segment.slice(0, cursor - segmentStart),
        cursor: segment[cursor - segmentStart] ?? ' ',
        after: segment.slice(cursor - segmentStart + 1),
        hasCursor: true,
      } : {
        before: segment,
        cursor: '',
        after: '',
        hasCursor: false,
      });

      segmentStart = segmentEnd;
    }

    logicalOffset = lineEnd + 1;
  }

  return rendered.length <= maxVisibleLines ? rendered : rendered.slice(rendered.length - maxVisibleLines);
}

export function resolvePromptInputRenderWidth(stdoutColumns?: number): number {
  return Math.max(PROMPT_PREFIX_WIDTH + 1, Math.floor(stdoutColumns ?? FALLBACK_RENDER_WIDTH));
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

function repeatSeparator(width: number): string {
  return '─'.repeat(Math.max(0, width));
}
