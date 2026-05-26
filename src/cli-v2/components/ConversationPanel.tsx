import React from 'react';
import { Box, Text } from 'ink';
import type { ControlPlaneSessionDetail } from '@/client-shared/api/types.js';

export function ConversationPanel({ session }: { session: ControlPlaneSessionDetail }) {
  const messages = session?.messages.slice(-10) ?? [];

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold>Conversation</Text>
      {messages.length === 0 ? <Text dimColor>No messages yet.</Text> : null}
      {messages.map((message, index) => (
        <Box key={message.id} flexDirection="column" marginBottom={1}>
          <Text dimColor>
            {message.role === 'user' ? `┌ You${message.isPending ? ' (queued)' : ''}` : '┌ Heddle'}
          </Text>
          <Box paddingLeft={2} flexDirection="column">
            {message.text.split(/\r?\n/).map((line, lineIndex) => (
              <Text key={`${message.id}-${lineIndex}`} color={message.role === 'user' ? 'cyan' : undefined}>
                {line || ' '}
              </Text>
            ))}
          </Box>
          <Text dimColor>{index === messages.length - 1 ? '└' : '└────────────────────────────────────────────────────────'}</Text>
        </Box>
      ))}
    </Box>
  );
}
