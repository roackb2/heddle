import React from 'react';
import { Box, Text } from 'ink';

const MAX_VISIBLE_MODELS = 8;

export function ModelPickerPanel({
  query,
  models,
  activeModel,
  highlightedIndex,
}: {
  query: string;
  models: string[];
  activeModel: string;
  highlightedIndex: number;
}) {
  const { visibleModels, startIndex } = getVisibleModels(models, highlightedIndex);

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text dimColor>Model picker</Text>
      <Text dimColor>
        {query ? `Search: ${query}` : 'Type after /model set to filter. Use ↑/↓ or Tab to choose.'}
      </Text>
      {visibleModels.length > 0 ?
        visibleModels.map((model, index) => {
          const absoluteIndex = startIndex + index;
          const isHighlighted = absoluteIndex === highlightedIndex;
          const isActive = model === activeModel;
          const marker = isHighlighted ? '◉' : '○';
          const suffix = isActive ? ' (current)' : '';
          return (
            <Text key={model} color={isHighlighted ? 'cyan' : undefined} dimColor={!isHighlighted}>
              {`${marker} ${model}${suffix}`}
            </Text>
          );
        })
      : <Text dimColor>No matching models.</Text>}
    </Box>
  );
}

function getVisibleModels(models: string[], highlightedIndex: number): { visibleModels: string[]; startIndex: number } {
  if (models.length <= MAX_VISIBLE_MODELS) {
    return { visibleModels: models, startIndex: 0 };
  }

  const half = Math.floor(MAX_VISIBLE_MODELS / 2);
  let startIndex = Math.max(0, highlightedIndex - half);
  const maxStart = Math.max(0, models.length - MAX_VISIBLE_MODELS);
  if (startIndex > maxStart) {
    startIndex = maxStart;
  }

  return {
    visibleModels: models.slice(startIndex, startIndex + MAX_VISIBLE_MODELS),
    startIndex,
  };
}
