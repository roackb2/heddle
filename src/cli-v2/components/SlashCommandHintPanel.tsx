import React from 'react';
import { Box, Text } from 'ink';
import type { ControlPlaneSlashCommandHint } from '@/client-shared/api/types.js';

const MAX_VISIBLE_HINTS = 8;

export function SlashCommandHintPanel({
  hints,
}: {
  hints: ControlPlaneSlashCommandHint[];
}) {
  if (hints.length === 0) {
    return null;
  }

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1} marginTop={1}>
      <Text bold>Slash commands</Text>
      {hints.slice(0, MAX_VISIBLE_HINTS).map((hint) => (
        <Box key={hint.command}>
          <Box width={30}>
            <Text color="cyan">{hint.command}</Text>
          </Box>
          <Text dimColor>{hint.description}</Text>
        </Box>
      ))}
    </Box>
  );
}
