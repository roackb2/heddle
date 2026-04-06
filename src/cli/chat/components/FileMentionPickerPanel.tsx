import React from 'react';
import { Box, Text } from 'ink';

const MAX_VISIBLE_FILES = 8;

export function FileMentionPickerPanel({
  query,
  files,
  highlightedIndex,
}: {
  query: string;
  files: string[];
  highlightedIndex: number;
}) {
  const { visibleFiles, startIndex } = getVisibleFiles(files, highlightedIndex);

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text dimColor>File mentions</Text>
      <Text dimColor>
        {query ? `Search: ${query}` : 'Type after @ to mention a file. Use ↑/↓ or Tab to choose.'}
      </Text>
      {visibleFiles.length > 0 ?
        visibleFiles.map((file, index) => {
          const absoluteIndex = startIndex + index;
          const isHighlighted = absoluteIndex === highlightedIndex;
          const marker = isHighlighted ? '◉' : '○';
          return (
            <Text key={file} color={isHighlighted ? 'cyan' : undefined} dimColor={!isHighlighted}>
              {`${marker} ${file}`}
            </Text>
          );
        })
      : <Text dimColor>No matching files.</Text>}
    </Box>
  );
}

function getVisibleFiles(files: string[], highlightedIndex: number): { visibleFiles: string[]; startIndex: number } {
  if (files.length <= MAX_VISIBLE_FILES) {
    return { visibleFiles: files, startIndex: 0 };
  }

  const half = Math.floor(MAX_VISIBLE_FILES / 2);
  let startIndex = Math.max(0, highlightedIndex - half);
  const maxStart = Math.max(0, files.length - MAX_VISIBLE_FILES);
  if (startIndex > maxStart) {
    startIndex = maxStart;
  }

  return {
    visibleFiles: files.slice(startIndex, startIndex + MAX_VISIBLE_FILES),
    startIndex,
  };
}
