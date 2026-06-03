// Keep this root component thin: wire top-level app state and render surfaces
// only. Put feature behavior in cli-v2 hooks, services, or focused components
// instead of growing App.tsx directly.
import React, { useCallback, useEffect, useRef } from 'react';
import { Box, Text } from 'ink';
import { ApprovalPanel } from './components/ApprovalPanel.js';
import { AgentPlanPanel } from './components/AgentPlanPanel.js';
import { CommandResultPanel } from './components/CommandResultPanel.js';
import { ConversationPanel } from './components/ConversationPanel.js';
import { DirectShellConfirmationPanel } from './components/DirectShellConfirmationPanel.js';
import { DirectShellModeHintPanel } from './components/DirectShellModeHintPanel.js';
import { FileMentionPickerPanel } from './components/FileMentionPickerPanel.js';
import { ModelPickerPanel } from './components/ModelPickerPanel.js';
import { PromptInput } from './components/PromptInput.js';
import { PromptStatusPanel } from './components/PromptStatusPanel.js';
import { QueuedPromptPanel } from './components/QueuedPromptPanel.js';
import { RecentEditDiffPanel } from './components/RecentEditDiffPanel.js';
import { ReasoningEffortPickerPanel } from './components/ReasoningEffortPickerPanel.js';
import { RunControls } from './components/RunControls.js';
import { RuntimeStatusBar } from './components/RuntimeStatusBar.js';
import { SessionPickerPanel } from './components/SessionPickerPanel.js';
import { SlashCommandHintPanel } from './components/SlashCommandHintPanel.js';
import { useControlPlaneSessionStore } from './hooks/useControlPlaneSessionStore.js';
import { useFileMentionPicker } from './hooks/useFileMentionPicker.js';
import { usePromptPickers } from './hooks/usePromptPickers.js';
import { usePromptDraft } from './hooks/usePromptDraft.js';
import { PromptActivityService } from './services/activities/prompt-activity-service.js';
import { ClientSharedPromptInputService } from '@/client-shared/services/prompt-input/index.js';
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
  const {
    draft,
    cursor,
    setDraft,
    setDraftState,
    clearDraft,
    recordSubmittedPrompt,
    navigateHistory,
    undoPromptEdit,
    redoPromptEdit,
  } = usePromptDraft();
  const submitDisabled = snapshot.loading || snapshot.submitting || Boolean(snapshot.pendingDirectShellConfirmation);
  const inputDisabled = snapshot.loading || Boolean(snapshot.pendingDirectShellConfirmation);
  const slashCommandHints = store.getSlashCommandHints(draft);
  const directShellDraft = ClientSharedPromptInputService.parseDirectShellDraft(draft);
  const pickers = usePromptPickers({
    draft,
    snapshot,
    clearDraft,
    onSelectModel: (model) => {
      void store.selectModelFromPicker(model);
    },
    onSelectReasoning: (reasoningEffort) => {
      void store.selectReasoningFromPicker(reasoningEffort);
    },
    onSelectSession: (sessionId) => {
      void store.selectSessionFromPicker(sessionId);
    },
  });
  const fileMentions = useFileMentionPicker({
    draft,
    setDraft,
    snapshot,
    store,
  });

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

    if (pickers.submitSelection()) {
      return;
    }

    clearDraft();
    if (!trimmed.startsWith('/')) {
      recordSubmittedPrompt(trimmed);
    }
    void store.submitPrompt(value);
  }, [
    clearDraft,
    pickers,
    recordSubmittedPrompt,
    store,
    submitDisabled,
  ]);

  const resolveApproval = useCallback((decision: ControlPlaneApprovalDecision) => {
    void store.resolvePendingApproval(decision);
  }, [store]);

  const resolveDirectShellConfirmation = useCallback((accepted: boolean) => {
    void store.resolveDirectShellConfirmation(accepted);
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
      <ConversationPanel runtimeContext={snapshot.runtimeContext} session={snapshot.activeSession} />
      <RecentEditDiffPanel diffs={snapshot.recentEditDiffs} />
      <CommandResultPanel results={snapshot.commandResults} />
      {snapshot.pendingApproval ? (
        <ApprovalPanel
          approval={snapshot.pendingApproval}
          resolving={snapshot.approvalResolving}
          onResolve={resolveApproval}
        />
      ) : null}
      {snapshot.pendingDirectShellConfirmation ? (
        <DirectShellConfirmationPanel
          confirmation={snapshot.pendingDirectShellConfirmation}
          onResolve={resolveDirectShellConfirmation}
        />
      ) : null}
      <RunControls
        running={snapshot.running}
        cancelling={snapshot.cancelling}
        onCancel={cancelRun}
      />
      <AgentPlanPanel plan={snapshot.activePlan} />
      {pickers.model.query !== undefined ? (
        <ModelPickerPanel
          query={pickers.model.query}
          models={pickers.model.items}
          activeModel={snapshot.runtimeContext?.model}
          highlightedIndex={pickers.model.highlightedIndex}
        />
      ) : null}
      {pickers.reasoning.query !== undefined ? (
        <ReasoningEffortPickerPanel
          query={pickers.reasoning.query}
          options={pickers.reasoning.items}
          activeReasoningEffort={snapshot.runtimeContext?.reasoningEffort}
          highlightedIndex={pickers.reasoning.highlightedIndex}
        />
      ) : null}
      {pickers.session.query !== undefined ? (
        <SessionPickerPanel
          query={pickers.session.query}
          sessions={pickers.session.items}
          activeSessionId={snapshot.activeSessionId}
          highlightedIndex={pickers.session.highlightedIndex}
        />
      ) : null}
      {fileMentions.visible ? (
        <FileMentionPickerPanel
          query={fileMentions.query}
          suggestions={fileMentions.suggestions}
          highlightedIndex={fileMentions.highlightedIndex}
          loading={fileMentions.loading}
          error={fileMentions.error}
        />
      ) : null}
      {!pickers.visible && !fileMentions.visible ? <SlashCommandHintPanel hints={slashCommandHints} /> : null}
      <PromptStatusPanel
        currentActivity={snapshot.currentActivity}
        latestActivity={PromptActivityService.build(snapshot)}
      />
      <QueuedPromptPanel session={snapshot.activeSession} />
      {directShellDraft && !snapshot.pendingDirectShellConfirmation ? (
        <DirectShellModeHintPanel command={directShellDraft.command} />
      ) : null}
      <PromptInput
        disabled={inputDisabled}
        submitDisabled={submitDisabled}
        placeholder={
          snapshot.loading ? 'Loading session...'
          : snapshot.running ? 'Queue a follow-up'
          : 'Type a prompt'
        }
        value={draft}
        cursor={cursor}
        onChange={setDraftState}
        onSubmit={submitPrompt}
        onComplete={(value) => store.completeSlashCommandDraft(value)}
        onHistory={navigateHistory}
        onUndo={undoPromptEdit}
        onRedo={redoPromptEdit}
        onSpecialKey={(input, key) => fileMentions.handleSpecialKey(input, key) || pickers.handleSpecialKey(input, key)}
      />
      <RuntimeStatusBar snapshot={snapshot} />
    </Box>
  );
}
