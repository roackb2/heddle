import React, { useCallback, useEffect, useRef } from 'react';
import { Box, Text } from 'ink';
import { ConversationPanel } from './components/ConversationPanel.js';
import { PromptInput } from './components/PromptInput.js';
import { buildPromptActivity } from './helpers/activities/prompt-activity.js';
import { useControlPlaneSessionStore } from './hooks/useControlPlaneSessionStore.js';
import { usePromptDraft } from './hooks/usePromptDraft.js';
import type {
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
  const { draft, setDraft, clearDraft } = usePromptDraft();
  const submitDisabled = snapshot.loading || snapshot.submitting;

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

    if (submitDisabled) {
      return;
    }

    clearDraft();
    void store.submitPrompt(value);
  }, [clearDraft, store, submitDisabled]);

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
        activity={buildPromptActivity(snapshot)}
        disabled={snapshot.loading}
        placeholder={snapshot.loading ? 'Loading session...' : 'Type a prompt'}
        value={draft}
        onChange={setDraft}
        onSubmit={submitPrompt}
      />
    </Box>
  );
}
