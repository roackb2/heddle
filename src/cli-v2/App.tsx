// Keep this root component thin: wire top-level app state and render surfaces
// only. Put feature behavior in cli-v2 hooks, services, or focused components
// instead of growing App.tsx directly.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useInput } from 'ink';
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
import { useRecentEditDiffReview } from './hooks/useRecentEditDiffReview.js';
import { PromptActivityService } from './services/activities/prompt-activity-service.js';
import { TuiLocalSlashCommandService } from './services/slash-commands/index.js';
import { ClientSharedSessionTurnPresentationService } from '@/client-shared/services/session-turn-presentation/index.js';
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
  const [activityExpanded, setActivityExpanded] = useState(false);
  const snapshot = useControlPlaneSessionStore(store);
  const recentEditDiffReview = useRecentEditDiffReview(snapshot.recentEditDiffs);
  const hasConversationActivityGroups = ClientSharedSessionTurnPresentationService
    .projectConversationTimeline(snapshot.activeSession)
    .some((item) => item.type === 'turn_activity_group');
  const hasCommandResults = snapshot.commandResults.some((result) => result.handled);

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

  useInput((input, key) => {
    recentEditDiffReview.handleReviewKey(input, key);
  }, { isActive: recentEditDiffReview.mode === 'review' });

  const localSlashCommandHandlers = useMemo(() => ({
    activity: () => {
      if (!hasConversationActivityGroups) {
        store.showLocalCommandMessage('No agent tool activities are available to expand.');
        return;
      }

      setActivityExpanded((current) => !current);
    },
    commandResults: () => {
      if (!hasCommandResults) {
        store.showLocalCommandMessage('No command output is available to expand.');
        return;
      }

      store.toggleCommandResultExpanded();
    },
    diff: () => {
      if (!recentEditDiffReview.hasDiffs) {
        store.showLocalCommandMessage('No recent edit diffs are available to review.');
        return;
      }

      recentEditDiffReview.open();
    },
  }), [hasCommandResults, hasConversationActivityGroups, recentEditDiffReview, store]);
  const localSlashCommandHints = useMemo(
    () => TuiLocalSlashCommandService.hints(),
    [],
  );
  const executeLocalSlashCommand = useCallback((command: string) => (
    TuiLocalSlashCommandService.execute(command, localSlashCommandHandlers)
  ), [localSlashCommandHandlers]);

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
      <ConversationPanel
        activityExpanded={activityExpanded}
        runtimeContext={snapshot.runtimeContext}
        session={snapshot.activeSession}
      />
      {snapshot.running ? (
        <RecentEditDiffPanel
          diffs={snapshot.recentEditDiffs}
          review={recentEditDiffReview}
          running={snapshot.running}
        />
      ) : null}
      <CommandResultPanel
        expanded={snapshot.commandResultExpanded}
        results={snapshot.commandResults}
      />
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
        keyboardDisabled={recentEditDiffReview.mode === 'review'}
        onCancel={cancelRun}
      />
      <AgentPlanPanel plan={snapshot.activePlan} />
      <PromptStatusPanel
        currentActivity={snapshot.currentActivity}
        latestActivity={PromptActivityService.build(snapshot)}
      />
      <QueuedPromptPanel session={snapshot.activeSession} />
      <ComposerPanel
        store={store}
        snapshot={snapshot}
        keyboardDisabled={recentEditDiffReview.mode === 'review'}
        localSlashCommandHints={localSlashCommandHints}
        onLocalSlashCommand={executeLocalSlashCommand}
      />
      <RuntimeStatusBar snapshot={snapshot} />
    </Box>
  );
}
