import React, { useCallback, useEffect, useRef } from 'react';
import { Box, Text } from 'ink';
import { ConversationPanel } from './components/ConversationPanel.js';
import { PromptInput } from './components/PromptInput.js';
import { useControlPlaneSessionStore } from './hooks/useControlPlaneSessionStore.js';
import type {
  ControlPlaneSessionLatestUpdate,
  ControlPlaneSessionStore,
  ControlPlaneSessionStoreStartInput,
} from './state/control-plane-session-store.js';

export function App({
  store,
  initialSelection,
}: {
  store: ControlPlaneSessionStore;
  initialSelection?: ControlPlaneSessionStoreStartInput;
}) {
  const startedRef = useRef(false);
  const snapshot = useControlPlaneSessionStore(store);

  useEffect(() => {
    if (startedRef.current) {
      return;
    }

    startedRef.current = true;
    void store.start(initialSelection);
    return () => {
      store.dispose();
    };
  }, [initialSelection, store]);

  const submitPrompt = useCallback((value: string) => {
    if (!value.trim()) {
      return;
    }

    void store.submitPrompt(value);
  }, [store]);

  const status = snapshot.error ?? snapshot.liveStatus;
  const latestUpdateText = formatLatestUpdate(snapshot.latestUpdate);
  const activity = snapshot.error
    ? { text: `Error: ${snapshot.error}`, color: 'red' as const }
    : latestUpdateText
      ? { text: latestUpdateText, color: getLatestUpdateColor(snapshot.latestUpdate) }
      : status
        ? { text: `Status: ${status}`, color: 'yellow' as const }
        : undefined;

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginBottom={1}>
        <Text bold>Heddle CLI V2</Text>
        <Text dimColor> · API-backed terminal UI</Text>
      </Box>
      <Text dimColor>
        {snapshot.workspaceId ? `Workspace ${snapshot.workspaceId}` : 'Loading workspace...'}
        {snapshot.activeSession ? ` · ${snapshot.activeSession.name}` : ''}
      </Text>
      <ConversationPanel session={snapshot.activeSession} />
      {snapshot.pendingApproval ? (
        <Text color="yellow">Approval requested. Approval controls are part of the next cli-v2 slice.</Text>
      ) : null}
      <PromptInput
        activity={activity}
        disabled={snapshot.loading || snapshot.submitting || snapshot.running || snapshot.cancelling}
        placeholder={snapshot.loading ? 'Loading session...' : 'Type a prompt'}
        onSubmit={submitPrompt}
      />
    </Box>
  );
}

function formatLatestUpdate(update: ControlPlaneSessionLatestUpdate | undefined): string | undefined {
  if (!update) {
    return undefined;
  }

  return update.detail ? `Latest: ${update.label} · ${update.detail}` : `Latest: ${update.label}`;
}

function getLatestUpdateColor(update: ControlPlaneSessionLatestUpdate | undefined): 'blue' | 'green' | 'yellow' | 'red' {
  const colors = {
    info: 'blue',
    success: 'green',
    warning: 'yellow',
    error: 'red',
  } as const;

  return colors[update?.tone ?? 'info'];
}
