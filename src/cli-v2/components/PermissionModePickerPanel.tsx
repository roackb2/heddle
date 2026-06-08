import React from 'react';
import { Box, Text } from 'ink';
import type { CliV2PermissionModePickerItem } from '../services/pickers/index.js';

const MAX_VISIBLE_OPTIONS = 8;

export function PermissionModePickerPanel({
  query,
  options,
  activePermissionMode,
  highlightedIndex,
}: {
  query: string;
  options: CliV2PermissionModePickerItem[];
  activePermissionMode?: string;
  highlightedIndex: number;
}) {
  const { visibleOptions, startIndex } = getVisibleOptions(options, highlightedIndex);

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text dimColor>Permission mode picker</Text>
      <Text dimColor>
        {query ? `Search: ${query}` : 'Type after /permissions set to filter. Use up/down or Tab to choose.'}
      </Text>
      {visibleOptions.length > 0 ?
        visibleOptions.map((option, index) => {
          const absoluteIndex = startIndex + index;
          const isHighlighted = absoluteIndex === highlightedIndex;
          const isActive = option.id === (activePermissionMode ?? 'default');
          const marker = isHighlighted ? '◉' : '○';
          const suffix = [
            isActive ? '(current)' : undefined,
            option.disabled ? `(${option.disabledReason ?? 'unavailable'})` : undefined,
          ].filter(Boolean).join(' ');
          return (
            <Text
              key={option.id}
              color={isHighlighted ? 'cyan' : undefined}
              dimColor={!isHighlighted}
            >
              {`${marker} ${option.label}${suffix ? ` ${suffix}` : ''} - ${option.description}`}
            </Text>
          );
        })
      : <Text dimColor>No matching permission modes.</Text>}
    </Box>
  );
}

function getVisibleOptions(
  options: CliV2PermissionModePickerItem[],
  highlightedIndex: number,
): { visibleOptions: CliV2PermissionModePickerItem[]; startIndex: number } {
  if (options.length <= MAX_VISIBLE_OPTIONS) {
    return { visibleOptions: options, startIndex: 0 };
  }

  const half = Math.floor(MAX_VISIBLE_OPTIONS / 2);
  const startIndex = Math.min(
    Math.max(0, highlightedIndex - half),
    Math.max(0, options.length - MAX_VISIBLE_OPTIONS),
  );

  return {
    visibleOptions: options.slice(startIndex, startIndex + MAX_VISIBLE_OPTIONS),
    startIndex,
  };
}
