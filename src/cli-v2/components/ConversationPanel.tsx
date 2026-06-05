import React, { memo } from 'react';
import { Box, Text } from 'ink';
import type { ControlPlaneSessionDetail, ControlPlaneSessionRuntimeContext } from '@/client-shared/api/types.js';
import { AssistantMarkdown } from './AssistantMarkdown.js';

type ConversationMessage = NonNullable<ControlPlaneSessionDetail>['messages'][number];

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
      <WelcomeGuideSlot show={showWelcome} runtimeContext={runtimeContext} />
      <EmptyConversationSlot show={messages.length === 0 && !showWelcome} />
      {messages.map((message, index) => (
        <Box key={message.id} flexDirection="column" marginBottom={1}>
          <Text dimColor>{resolveMessageLabel(message)}</Text>
          <Box paddingLeft={2} flexDirection="column">
            <MessageBody message={message} />
          </Box>
          <Text dimColor>{index === messages.length - 1 ? '└' : '└────────────────────────────────────────────────────────'}</Text>
        </Box>
      ))}
    </Box>
  );
});

function WelcomeGuideSlot({
  runtimeContext,
  show,
}: {
  runtimeContext?: ControlPlaneSessionRuntimeContext;
  show: boolean;
}) {
  if (!show || !runtimeContext?.welcomeGuide) {
    return null;
  }

  return <WelcomeGuide runtimeContext={runtimeContext} />;
}

function EmptyConversationSlot({ show }: { show: boolean }) {
  return show ? <Text dimColor>No messages yet.</Text> : null;
}

function resolveMessageLabel(message: ConversationMessage): string {
  if (message.role !== 'user') {
    return '┌ Heddle';
  }

  return message.isPending ? '┌ You (queued)' : '┌ You';
}

function MessageBody({ message }: { message: ConversationMessage }) {
  if (message.directShellResult) {
    return <DirectShellResult result={message.directShellResult} />;
  }

  if (message.role === 'assistant') {
    return <AssistantMarkdown>{message.text}</AssistantMarkdown>;
  }

  return message.text.split(/\r?\n/).map((line, lineIndex) => (
    <Text key={`${message.id}-${lineIndex}`} color="cyan">
      {line || ' '}
    </Text>
  ));
}

type DirectShellResultView = NonNullable<NonNullable<ControlPlaneSessionDetail>['messages'][number]['directShellResult']>;

function DirectShellResult({ result }: { result: DirectShellResultView }) {
  return (
    <Box flexDirection="column">
      <Text>
        <Text color={result.outcome === 'done' ? 'green' : 'red'}>{result.outcome}</Text>
        <Text dimColor> shell </Text>
        <Text>{result.command}</Text>
      </Text>
      {result.policy?.reason ? <Text dimColor>{result.policy.reason}</Text> : null}
      {result.stdout ? <OutputBlock label="stdout" value={result.stdout} /> : null}
      {result.stderr ? <OutputBlock label="stderr" value={result.stderr} /> : null}
      {result.error ? <OutputBlock label="error" value={result.error} /> : null}
    </Box>
  );
}

function OutputBlock({ label, value }: { label: string; value: string }) {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text dimColor>{label}</Text>
      {value.split(/\r?\n/).map((line, index) => (
        <Text key={`${label}-${index}`}>{line || ' '}</Text>
      ))}
    </Box>
  );
}

function WelcomeGuide({ runtimeContext }: { runtimeContext: ControlPlaneSessionRuntimeContext }) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text dimColor>┌ Heddle</Text>
      <Box paddingLeft={2} flexDirection="column">
        <Text>Heddle conversational mode.</Text>
        <Text> </Text>
        <Text>Ask a question about this workspace.</Text>
        <WelcomeTranscriptHint runtimeContext={runtimeContext} />
        <WelcomeCredentialWarning runtimeContext={runtimeContext} />
      </Box>
      <Text dimColor>└────────────────────────────────────────────────────────</Text>
    </Box>
  );
}

function WelcomeTranscriptHint({ runtimeContext }: { runtimeContext: ControlPlaneSessionRuntimeContext }) {
  return runtimeContext.welcomeGuide.carriesTranscriptAcrossTurns ? (
    <Text>Each turn runs the current agent loop and carries the transcript into the next turn.</Text>
  ) : null;
}

function WelcomeCredentialWarning({ runtimeContext }: { runtimeContext: ControlPlaneSessionRuntimeContext }) {
  return runtimeContext.welcomeGuide.hasProviderCredential ? null : (
    <Text color="yellow">No provider credential detected. Use /auth login openai or set a provider API key.</Text>
  );
}
