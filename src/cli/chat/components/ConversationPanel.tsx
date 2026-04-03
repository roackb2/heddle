import React from 'react';
import { Box, Text } from 'ink';
import type { ConversationLine } from '../state/types.js';

export function ConversationPanel({ messages }: { messages: ConversationLine[] }) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold>Conversation</Text>
      {messages.slice(-8).map((message) => (
        <Box key={message.id} borderStyle="round" borderColor={message.role === 'user' ? 'cyan' : 'gray'} paddingX={1} marginBottom={1}>
          <Text color={message.role === 'user' ? 'cyan' : 'white'}>
            {message.role === 'user' ? 'You' : 'Heddle'}: {message.text}
          </Text>
        </Box>
      ))}
    </Box>
  );
}
