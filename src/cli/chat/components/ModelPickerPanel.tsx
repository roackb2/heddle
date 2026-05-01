import React from 'react';
import { Box, Text } from 'ink';
import { OPENAI_OAUTH_MODE_DESCRIPTION, type CredentialAwareModelOption } from '../../../core/llm/model-policy.js';

const MAX_VISIBLE_MODELS = 8;

export function ModelPickerPanel({
  query,
  models,
  activeModel,
  highlightedIndex,
}: {
  query: string;
  models: CredentialAwareModelOption[];
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
      {visibleModels.some((model) => model.disabled) ? <Text dimColor>{OPENAI_OAUTH_MODE_DESCRIPTION}</Text> : null}
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
              {isHighlighted && model.disabled ? ` — ${OPENAI_OAUTH_MODE_DESCRIPTION}` : ''}
            </Text>
          );
        })
      : <Text dimColor>No matching models.</Text>}
    </Box>
  );
}

function getVisibleModels(models: CredentialAwareModelOption[], highlightedIndex: number): {
  visibleModels: CredentialAwareModelOption[];
  startIndex: number;
} {
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
