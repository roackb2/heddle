import React, { useCallback, useEffect, useRef } from 'react';
import { Box, Text } from 'ink';
import { ApprovalPanel } from './components/ApprovalPanel.js';
import { CommandResultPanel } from './components/CommandResultPanel.js';
import { ConversationPanel } from './components/ConversationPanel.js';
import { PromptInput } from './components/PromptInput.js';
import { RunControls } from './components/RunControls.js';
import { SlashCommandHintPanel } from './components/SlashCommandHintPanel.js';
import { useControlPlaneSessionStore } from './hooks/useControlPlaneSessionStore.js';
import { usePromptDraft } from './hooks/usePromptDraft.js';
import { PromptActivityService } from './services/activities/prompt-activity-service.js';
import type { ControlPlaneApprovalDecision } from '@/client-shared/api/types.js';
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
  const submitDisabled = snapshot.loading || snapshot.submitting || snapshot.running;
  const inputDisabled = snapshot.loading;
  const slashCommandHints = store.getSlashCommandHints(draft);

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
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }

    if (submitDisabled) {
      return;
    }

    clearDraft();
    void store.submitPrompt(value);
  }, [clearDraft, store, submitDisabled]);

  const resolveApproval = useCallback((decision: ControlPlaneApprovalDecision) => {
    void store.resolvePendingApproval(decision);
  }, [store]);

  const cancelRun = useCallback(() => {
    void store.cancelRun();
  }, [store]);

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
      <CommandResultPanel results={snapshot.commandResults} />
      {snapshot.pendingApproval ? (
        <ApprovalPanel
          approval={snapshot.pendingApproval}
          resolving={snapshot.approvalResolving}
          onResolve={resolveApproval}
        />
      ) : null}
      <RunControls
        running={snapshot.running}
        cancelling={snapshot.cancelling}
        onCancel={cancelRun}
      />
      <SlashCommandHintPanel hints={slashCommandHints} />
      <PromptInput
        activity={PromptActivityService.build(snapshot)}
        disabled={inputDisabled}
        submitDisabled={submitDisabled || Boolean(snapshot.pendingApproval)}
        placeholder={
          snapshot.loading ? 'Loading session...'
          : snapshot.running ? 'Run in progress'
          : 'Type a prompt'
        }
        value={draft}
        onChange={setDraft}
        onSubmit={submitPrompt}
        onComplete={(value) => store.completeSlashCommandDraft(value)}
      />
    </Box>
  );
}
