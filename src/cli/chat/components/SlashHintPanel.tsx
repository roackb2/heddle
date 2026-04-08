import React from 'react';
import { Box, Text } from 'ink';
import type { ChatSession } from '../state/types.js';
import { getLocalCommandHints, isLikelyLocalCommand } from '../state/local-commands.js';

export function SlashHintPanel({
  draft,
  activeSessionId,
  sessions,
}: {
  draft: string;
  activeSessionId: string;
  sessions: ChatSession[];
}) {
  const hints = getLocalCommandHints(draft, activeSessionId, sessions).slice(0, 10);

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text dimColor>Slash commands</Text>
      {hints.map((hint) => (
        <Text key={hint.command} dimColor>
          {hint.command} {hint.description}
        </Text>
      ))}
    </Box>
  );
}

export function shouldShowSlashHints(draft: string): boolean {
  return isLikelyLocalCommand(draft);
}
