// Keep this root component thin: wire top-level app state and render surfaces
// only. Put feature behavior in cli-v2 hooks, services, or focused components
// instead of growing App.tsx directly.
import React, { useCallback, useEffect, useRef } from 'react';
import { Box, Text } from 'ink';
import { ApprovalPanel } from './components/ApprovalPanel.js';
import { AgentPlanPanel } from './components/AgentPlanPanel.js';
import { ComposerPanel } from './components/ComposerPanel.js';
import { CommandResultPanel } from './components/CommandResultPanel.js';
import { ConversationPanel } from './components/ConversationPanel.js';
import { DirectShellConfirmationPanel } from './components/DirectShellConfirmationPanel.js';
import { PromptStatusPanel } from './components/PromptStatusPanel.js';
import { QueuedPromptPanel } from './components/QueuedPromptPanel.js';
import { RecentEditDiffPanel } from './components/RecentEditDiffPanel.js';
import { RunControls } from './components/RunControls.js';
import { RuntimeStatusBar } from './components/RuntimeStatusBar.js';
import { useControlPlaneSessionStore } from './hooks/useControlPlaneSessionStore.js';
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
      <PromptStatusPanel
        currentActivity={snapshot.currentActivity}
        latestActivity={PromptActivityService.build(snapshot)}
      />
      <QueuedPromptPanel session={snapshot.activeSession} />
      <ComposerPanel store={store} snapshot={snapshot} />
      <RuntimeStatusBar snapshot={snapshot} />
    </Box>
  );
}
