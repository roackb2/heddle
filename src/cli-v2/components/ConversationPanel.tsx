import React, { memo } from 'react';
import { Box, Text } from 'ink';
import type { ControlPlaneSessionDetail, ControlPlaneSessionRuntimeContext } from '@/client-shared/api/types.js';

export const ConversationPanel = memo(function ConversationPanel({
  runtimeContext,
  session,
}: {
  runtimeContext?: ControlPlaneSessionRuntimeContext;
  session: ControlPlaneSessionDetail;
}) {
  const messages = session?.messages.slice(-10) ?? [];
  const showWelcome = Boolean(session && runtimeContext?.welcomeGuide && !session.messages.some((message) => message.role === 'user'));

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold>Conversation</Text>
      {showWelcome && runtimeContext?.welcomeGuide ? <WelcomeGuide runtimeContext={runtimeContext} /> : null}
      {messages.length === 0 && !showWelcome ? <Text dimColor>No messages yet.</Text> : null}
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
});

function WelcomeGuide({ runtimeContext }: { runtimeContext: ControlPlaneSessionRuntimeContext }) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text dimColor>┌ Heddle</Text>
      <Box paddingLeft={2} flexDirection="column">
        <Text>Heddle conversational mode.</Text>
        <Text> </Text>
        <Text>Ask a question about this workspace.</Text>
        {runtimeContext.welcomeGuide.carriesTranscriptAcrossTurns ? (
          <Text>Each turn runs the current agent loop and carries the transcript into the next turn.</Text>
        ) : null}
        {!runtimeContext.welcomeGuide.hasProviderCredential ? (
          <Text color="yellow">No provider credential detected. Use /auth login openai or set a provider API key.</Text>
        ) : null}
      </Box>
      <Text dimColor>└────────────────────────────────────────────────────────</Text>
    </Box>
  );
}
