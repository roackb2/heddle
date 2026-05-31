import React from 'react';
import { Box, Text } from 'ink';
import type { ControlPlaneSessionDetail } from '@/client-shared/api/types.js';

export function QueuedPromptPanel({ session }: { session: ControlPlaneSessionDetail }) {
  const queuedPrompts = session?.queuedPrompts ?? [];
  if (!queuedPrompts.length) {
    return null;
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold color="cyan">Queued follow-ups</Text>
      {queuedPrompts.slice(0, 5).map((item, index) => (
        <Text key={item.id} dimColor={index > 0}>
          {index + 1}. {item.prompt}
        </Text>
      ))}
      {queuedPrompts.length > 5 ? (
        <Text dimColor>… {queuedPrompts.length - 5} more queued</Text>
      ) : null}
    </Box>
  );
}
