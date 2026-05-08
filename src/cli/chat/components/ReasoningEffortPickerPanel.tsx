import React from 'react';
import { Box, Text } from 'ink';
import type { ReasoningEffortPickerOption } from '../hooks/useChatPickers.js';
import type { ReasoningEffort } from '../../../core/llm/types.js';

const MAX_VISIBLE_EFFORTS = 6;

export function ReasoningEffortPickerPanel({
  query,
  options,
  activeReasoningEffort,
  highlightedIndex,
}: {
  query: string;
  options: ReasoningEffortPickerOption[];
  activeReasoningEffort?: ReasoningEffort;
  highlightedIndex: number;
}) {
  const { visibleOptions, startIndex } = getVisibleOptions(options, highlightedIndex);
  const activeId = activeReasoningEffort ?? 'default';

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text dimColor>Reasoning effort picker</Text>
      <Text dimColor>
        {query ? `Search: ${query}` : 'Type after /reasoning set to filter. Use ↑/↓ or Tab to choose.'}
      </Text>
      {visibleOptions.length > 0 ?
        visibleOptions.map((option, index) => {
          const absoluteIndex = startIndex + index;
          const isHighlighted = absoluteIndex === highlightedIndex;
          const isActive = option.id === activeId;
          const marker = isHighlighted ? '◉' : '○';
          const suffix = [
            isActive ? '(current)' : undefined,
            option.disabled ? `(${option.disabledReason ?? 'unavailable'})` : undefined,
          ].filter(Boolean).join(' ');

          return (
            <Text
              key={option.id}
              color={isHighlighted ? 'cyan' : option.disabled ? 'yellow' : undefined}
              dimColor={!isHighlighted && !option.disabled}
            >
              {`${marker} ${option.label}${suffix ? ` ${suffix}` : ''} — ${option.description}`}
            </Text>
          );
        })
      : <Text dimColor>No matching reasoning efforts.</Text>}
    </Box>
  );
}

function getVisibleOptions(
  options: ReasoningEffortPickerOption[],
  highlightedIndex: number,
): { visibleOptions: ReasoningEffortPickerOption[]; startIndex: number } {
  if (options.length <= MAX_VISIBLE_EFFORTS) {
    return { visibleOptions: options, startIndex: 0 };
  }

  const half = Math.floor(MAX_VISIBLE_EFFORTS / 2);
  let startIndex = Math.max(0, highlightedIndex - half);
  const maxStart = Math.max(0, options.length - MAX_VISIBLE_EFFORTS);
  if (startIndex > maxStart) {
    startIndex = maxStart;
  }

  return {
    visibleOptions: options.slice(startIndex, startIndex + MAX_VISIBLE_EFFORTS),
    startIndex,
  };
}
