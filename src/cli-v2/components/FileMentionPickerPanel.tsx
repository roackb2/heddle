import React from 'react';
import { Box, Text } from 'ink';
import type { ControlPlaneWorkspaceFileSuggestion } from '@/client-shared/api/types.js';

const MAX_VISIBLE_FILES = 8;

export function FileMentionPickerPanel({
  query,
  suggestions,
  highlightedIndex,
  loading,
  error,
}: {
  query: string;
  suggestions: ControlPlaneWorkspaceFileSuggestion[];
  highlightedIndex: number;
  loading: boolean;
  error?: string;
}) {
  const { visibleSuggestions, startIndex } = getVisibleSuggestions(suggestions, highlightedIndex);

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text dimColor>File mentions</Text>
      <Text dimColor>
        {query ? `Search: ${query}` : 'Type after @ to search workspace files. Use up/down and Tab to choose.'}
      </Text>
      {error ? (
        <Text color="yellow">File search unavailable: {error}</Text>
      ) : visibleSuggestions.length > 0 ? (
        visibleSuggestions.map((suggestion, index) => {
          const absoluteIndex = startIndex + index;
          const isHighlighted = absoluteIndex === highlightedIndex;
          return (
            <Text
              key={suggestion.path}
              color={isHighlighted ? 'cyan' : undefined}
              dimColor={!isHighlighted}
            >
              {`${isHighlighted ? '◉' : '○'} @${suggestion.path}`}
            </Text>
          );
        })
      ) : (
        <Text dimColor>{loading ? 'Searching workspace files...' : 'No matching files.'}</Text>
      )}
    </Box>
  );
}

function getVisibleSuggestions(
  suggestions: ControlPlaneWorkspaceFileSuggestion[],
  highlightedIndex: number,
): { visibleSuggestions: ControlPlaneWorkspaceFileSuggestion[]; startIndex: number } {
  if (suggestions.length <= MAX_VISIBLE_FILES) {
    return { visibleSuggestions: suggestions, startIndex: 0 };
  }

  const half = Math.floor(MAX_VISIBLE_FILES / 2);
  const startIndex = Math.min(
    Math.max(0, highlightedIndex - half),
    Math.max(0, suggestions.length - MAX_VISIBLE_FILES),
  );

  return {
    visibleSuggestions: suggestions.slice(startIndex, startIndex + MAX_VISIBLE_FILES),
    startIndex,
  };
}
