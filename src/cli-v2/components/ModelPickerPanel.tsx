import React from 'react';
import { Box, Text } from 'ink';
import type { CliV2ModelPickerItem } from '../services/pickers/index.js';

const MAX_VISIBLE_MODELS = 8;

export function ModelPickerPanel({
  query,
  models,
  activeModel,
  highlightedIndex,
}: {
  query: string;
  models: CliV2ModelPickerItem[];
  activeModel?: string;
  highlightedIndex: number;
}) {
  const { visibleModels, startIndex } = getVisibleModels(models, highlightedIndex);

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text dimColor>Model picker</Text>
      <Text dimColor>
        {query ? `Search: ${query}` : 'Type after /model set to filter. Use up/down or Tab to choose.'}
      </Text>
      {visibleModels.length > 0 ?
        visibleModels.map((model, index) => {
          const absoluteIndex = startIndex + index;
          const isHighlighted = absoluteIndex === highlightedIndex;
          const isActive = model.id === activeModel;
          const marker = isHighlighted ? '◉' : '○';
          const suffix = [
            isActive ? '(current)' : undefined,
            model.disabled ? `(${model.disabledReason ?? 'unavailable'})` : undefined,
          ].filter(Boolean).join(' ');
          return (
            <Text
              key={model.id}
              color={isHighlighted ? 'cyan' : model.disabled ? 'yellow' : undefined}
              dimColor={!isHighlighted && !model.disabled}
            >
              {`${marker} ${model.id}${suffix ? ` ${suffix}` : ''}`}
              {isHighlighted && model.disabled ? ` - ${model.disabledReason ?? 'unavailable'}` : ''}
            </Text>
          );
        })
      : <Text dimColor>No matching models.</Text>}
    </Box>
  );
}

function getVisibleModels(
  models: CliV2ModelPickerItem[],
  highlightedIndex: number,
): { visibleModels: CliV2ModelPickerItem[]; startIndex: number } {
  if (models.length <= MAX_VISIBLE_MODELS) {
    return { visibleModels: models, startIndex: 0 };
  }

  const half = Math.floor(MAX_VISIBLE_MODELS / 2);
  const startIndex = Math.min(
    Math.max(0, highlightedIndex - half),
    Math.max(0, models.length - MAX_VISIBLE_MODELS),
  );

  return {
    visibleModels: models.slice(startIndex, startIndex + MAX_VISIBLE_MODELS),
    startIndex,
  };
}
