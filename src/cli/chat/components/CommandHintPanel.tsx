import React from 'react';
import { Box, Text } from 'ink';
import { truncate } from '../utils/format.js';

export function CommandHintPanel({ draft }: { draft: string }) {
  const command = draft.trim().slice(1).trim();
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text dimColor>Direct shell</Text>
      <Text dimColor>
        {command ?
          `Run ${truncate(command, 100)} directly in chat. Read-oriented commands stay in inspect mode; other commands fall back to approval-gated execution.`
        : 'Start with ! to run a shell command directly in chat.'}
      </Text>
    </Box>
  );
}

export function shouldShowCommandHint(draft: string): boolean {
  return draft.trimStart().startsWith('!');
}
