import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Text } from 'ink';
import { ApprovalPanel } from './components/ApprovalPanel.js';
import { CommandResultPanel } from './components/CommandResultPanel.js';
import { ConversationPanel } from './components/ConversationPanel.js';
import { ModelPickerPanel } from './components/ModelPickerPanel.js';
import { PromptInput } from './components/PromptInput.js';
import { RunControls } from './components/RunControls.js';
import { RuntimeStatusBar } from './components/RuntimeStatusBar.js';
import { SessionPickerPanel } from './components/SessionPickerPanel.js';
import { SlashCommandHintPanel } from './components/SlashCommandHintPanel.js';
import { useControlPlaneSessionStore } from './hooks/useControlPlaneSessionStore.js';
import { usePromptDraft } from './hooks/usePromptDraft.js';
import { PromptActivityService } from './services/activities/prompt-activity-service.js';
import { CliV2PickerService } from './services/pickers/index.js';
import type { ControlPlaneApprovalDecision } from '@/client-shared/api/types.js';
import type { PromptInputKey } from './components/PromptInput.js';
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
  const [modelPickerIndex, setModelPickerIndex] = useState(0);
  const [sessionPickerIndex, setSessionPickerIndex] = useState(0);
  const modelPickerQuery = CliV2PickerService.modelQuery(draft);
  const sessionPickerQuery = CliV2PickerService.sessionQuery(draft);
  const modelPickerItems = CliV2PickerService.filterModels(snapshot.modelOptions, modelPickerQuery);
  const sessionPickerItems = CliV2PickerService.filterSessions(snapshot.sessions, sessionPickerQuery);
  const safeModelPickerIndex = CliV2PickerService.clampIndex(modelPickerIndex, modelPickerItems.length);
  const safeSessionPickerIndex = CliV2PickerService.clampIndex(sessionPickerIndex, sessionPickerItems.length);
  const highlightedModel = modelPickerItems[safeModelPickerIndex];
  const highlightedSession = sessionPickerItems[safeSessionPickerIndex];
  const pickerVisible = modelPickerQuery !== undefined || sessionPickerQuery !== undefined;

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

  useEffect(() => {
    setModelPickerIndex(0);
  }, [modelPickerQuery]);

  useEffect(() => {
    setSessionPickerIndex(0);
  }, [sessionPickerQuery]);

  const submitPrompt = useCallback((value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }

    if (submitDisabled) {
      return;
    }

    if (modelPickerQuery !== undefined && highlightedModel) {
      if (highlightedModel.disabled) {
        return;
      }

      clearDraft();
      setModelPickerIndex(0);
      void store.selectModelFromPicker(highlightedModel.id);
      return;
    }

    if (sessionPickerQuery !== undefined && highlightedSession) {
      clearDraft();
      setSessionPickerIndex(0);
      void store.selectSessionFromPicker(highlightedSession.id);
      return;
    }

    clearDraft();
    void store.submitPrompt(value);
  }, [
    clearDraft,
    highlightedModel,
    highlightedSession,
    modelPickerQuery,
    sessionPickerQuery,
    store,
    submitDisabled,
  ]);

  const handleSpecialKey = useCallback((_input: string, key: PromptInputKey) => {
    if (modelPickerQuery !== undefined) {
      if ((key.upArrow || key.leftArrow) && modelPickerItems.length > 0) {
        setModelPickerIndex((current) => CliV2PickerService.previousIndex(current, modelPickerItems.length));
        return true;
      }

      if ((key.downArrow || key.rightArrow || key.tab) && modelPickerItems.length > 0) {
        setModelPickerIndex((current) => CliV2PickerService.nextIndex(current, modelPickerItems.length));
        return true;
      }

      if (key.escape) {
        clearDraft();
        setModelPickerIndex(0);
        return true;
      }
    }

    if (sessionPickerQuery !== undefined) {
      if ((key.upArrow || key.leftArrow) && sessionPickerItems.length > 0) {
        setSessionPickerIndex((current) => CliV2PickerService.previousIndex(current, sessionPickerItems.length));
        return true;
      }

      if ((key.downArrow || key.rightArrow || key.tab) && sessionPickerItems.length > 0) {
        setSessionPickerIndex((current) => CliV2PickerService.nextIndex(current, sessionPickerItems.length));
        return true;
      }

      if (key.escape) {
        clearDraft();
        setSessionPickerIndex(0);
        return true;
      }
    }

    return false;
  }, [
    clearDraft,
    modelPickerItems.length,
    modelPickerQuery,
    sessionPickerItems.length,
    sessionPickerQuery,
  ]);

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
      {modelPickerQuery !== undefined ? (
        <ModelPickerPanel
          query={modelPickerQuery}
          models={modelPickerItems}
          activeModel={snapshot.runtimeContext?.model}
          highlightedIndex={safeModelPickerIndex}
        />
      ) : null}
      {sessionPickerQuery !== undefined ? (
        <SessionPickerPanel
          query={sessionPickerQuery}
          sessions={sessionPickerItems}
          activeSessionId={snapshot.activeSessionId}
          highlightedIndex={safeSessionPickerIndex}
        />
      ) : null}
      {!pickerVisible ? <SlashCommandHintPanel hints={slashCommandHints} /> : null}
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
        onSpecialKey={handleSpecialKey}
      />
      <RuntimeStatusBar snapshot={snapshot} />
    </Box>
  );
}
