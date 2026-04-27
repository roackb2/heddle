import { useCallback, useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import './control-plane.css';
import type { ControlPlaneState } from '../../lib/api';
import type { ScreenshotMode } from '../../lib/debug/layoutSnapshot';
import { useControlPlaneState } from './hooks/useControlPlaneState';
import { useControlPlaneNavigation } from './hooks/useControlPlaneNavigation';
import { useLayoutSnapshot } from './hooks/useLayoutSnapshot';
import { useIsMobile } from './hooks/useIsMobile';
import { useSessionsScreenState } from './hooks/useSessionsScreenState';
import { useTasksScreenState } from './hooks/useTasksScreenState';
import { useWorkspaceMutations } from './hooks/useWorkspaceMutations';
import { Panel } from './components/common';
import { DesktopControlPlaneShell } from './shell/DesktopControlPlaneShell';
import { MobileControlPlaneShell } from './shell/MobileControlPlaneShell';
import { OverviewScreen } from './screens/OverviewScreen';
import { SessionsScreen } from './screens/SessionsScreen';
import { TasksScreen } from './screens/TasksScreen';
import { WorkspacesScreen } from './screens/WorkspacesScreen';
import { Toaster } from '../../components/ui/toaster';
import { useToast } from '../../components/ui/use-toast';

declare global {
  interface Window {
    __HEDDLE_CAPTURE_LAYOUT_SNAPSHOT?: (options?: { screenshot?: ScreenshotMode }) => Promise<void>;
  }
}

export function ControlPlaneApp() {
  const navigation = useControlPlaneNavigation();
  const { state, error, refresh, setActiveWorkspace, createWorkspace, renameWorkspace } = useControlPlaneState();
  const { toasts, toast: notifyToast } = useToast();
  const isMobile = useIsMobile();
  const refreshControlPlaneState = useCallback(() => {
    void refresh();
  }, [refresh]);
  const sessionsState = useSessionsScreenState(state?.sessions, notifyToast, refreshControlPlaneState, {
    selectedSessionId: navigation.routeSessionId,
    onSelectedSessionIdChange: navigation.setRouteSessionId,
    autoSelectSession: navigation.section === 'sessions',
  });
  const tasksState = useTasksScreenState(
    state?.heartbeat.tasks,
    state?.heartbeat.runs,
    notifyToast,
    refreshControlPlaneState,
  );
  const workspaceMutations = useWorkspaceMutations({
    state,
    setActiveWorkspace,
    createWorkspace,
    renameWorkspace,
    notify: notifyToast,
  });
  const captureLayoutSnapshot = useLayoutSnapshot({
    section: navigation.section,
    sessionsState,
    error,
    toasts,
    notify: notifyToast,
  });

  useEffect(() => {
    navigation.normalizeRoute();
  }, [navigation]);

  useEffect(() => {
    window.__HEDDLE_CAPTURE_LAYOUT_SNAPSHOT = async (options) => {
      await captureLayoutSnapshot(options?.screenshot ?? 'none');
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || !event.shiftKey || event.key.toLowerCase() !== 'd') {
        return;
      }
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
        return;
      }
      event.preventDefault();
      void captureLayoutSnapshot('none');
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      if (window.__HEDDLE_CAPTURE_LAYOUT_SNAPSHOT) {
        delete window.__HEDDLE_CAPTURE_LAYOUT_SNAPSHOT;
      }
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [captureLayoutSnapshot]);

  const activeContent = !state ?
    <Panel title="Loading state">
      <p className="muted">{error ?? 'Reading local Heddle state...'}</p>
    </Panel>
  : renderActiveSection(state, sessionsState, tasksState, workspaceMutations);

  if (isMobile) {
    return (
      <>
        <MobileControlPlaneShell
          section={navigation.section}
          onSectionChange={navigation.setSection}
          state={state}
          error={error}
          onSetActiveWorkspace={(workspaceId) => void workspaceMutations.switchWorkspace(workspaceId)}
          onCaptureDebugSnapshot={(screenshot) => void captureLayoutSnapshot(screenshot)}
          onRefresh={() => void refresh()}
        >
          {activeContent}
        </MobileControlPlaneShell>
        <Toaster />
      </>
    );
  }

  return (
    <>
      <DesktopControlPlaneShell
        activeSection={navigation.section}
        sessionPath={navigation.routeSessionId ? `/sessions/${encodeURIComponent(navigation.routeSessionId)}` : '/sessions'}
        state={state}
        error={error}
        onSetActiveWorkspace={(workspaceId) => void workspaceMutations.switchWorkspace(workspaceId)}
        onCaptureDebugSnapshot={(screenshot) => void captureLayoutSnapshot(screenshot)}
        onRefresh={() => void refresh()}
      >
        {activeContent}
      </DesktopControlPlaneShell>
      <Toaster />
    </>
  );
}

function renderActiveSection(
  state: ControlPlaneState,
  sessionsState: ReturnType<typeof useSessionsScreenState>,
  tasksState: ReturnType<typeof useTasksScreenState>,
  workspaceMutations: ReturnType<typeof useWorkspaceMutations>,
) {
  return (
    <Routes>
      <Route path="/overview" element={<OverviewScreen state={state} />} />
      <Route path="/sessions" element={<SessionsRoute state={state} sessionsState={sessionsState} />} />
      <Route path="/sessions/:sessionId/*" element={<SessionsRoute state={state} sessionsState={sessionsState} />} />
      <Route
        path="/tasks"
        element={(
          <TasksScreen
            tasks={state.heartbeat.tasks}
            runs={state.heartbeat.runs}
            selectedTask={tasksState.selectedTask}
            selectedTaskId={tasksState.selectedTaskId}
            onSelectTask={tasksState.setSelectedTaskId}
            selectedRun={tasksState.selectedRun}
            selectedRunId={tasksState.selectedRunId}
            onSelectRun={tasksState.setSelectedRunId}
            selectedTaskRuns={tasksState.selectedTaskRuns}
            pendingTaskAction={tasksState.pendingTaskAction}
            onEnableTask={tasksState.enableTask}
            onDisableTask={tasksState.disableTask}
            onTriggerTask={tasksState.triggerTask}
          />
        )}
      />
      <Route
        path="/workspaces"
        element={(
          <WorkspacesScreen
            state={state}
            creatingWorkspace={workspaceMutations.creatingWorkspace}
            renamingWorkspaceId={workspaceMutations.renamingWorkspaceId}
            onCreateWorkspace={workspaceMutations.createWorkspace}
            onRenameWorkspace={workspaceMutations.renameWorkspace}
            onSetActiveWorkspace={(workspaceId) => void workspaceMutations.switchWorkspace(workspaceId)}
          />
        )}
      />
      <Route path="*" element={<Navigate to="/overview" replace />} />
    </Routes>
  );
}

function SessionsRoute({
  state,
  sessionsState,
}: {
  state: ControlPlaneState;
  sessionsState: ReturnType<typeof useSessionsScreenState>;
}) {
  return (
    <SessionsScreen
      sessions={state.sessions}
      activeSession={sessionsState.activeSession}
      sessionDetail={sessionsState.sessionDetail}
      sessionDetailLoading={sessionsState.sessionDetailLoading}
      sessionDetailError={sessionsState.sessionDetailError}
      selectedSessionId={sessionsState.selectedSessionId}
      onSelectSession={sessionsState.setSelectedSessionId}
      selectedTurnId={sessionsState.selectedTurnId}
      onSelectTurn={sessionsState.setSelectedTurnId}
      selectedTurn={sessionsState.selectedTurn}
      turnReview={sessionsState.turnReview}
      turnReviewLoading={sessionsState.turnReviewLoading}
      turnReviewError={sessionsState.turnReviewError}
      sendingPrompt={sessionsState.sendingPrompt}
      runInFlight={sessionsState.runInFlight}
      memoryUpdating={sessionsState.memoryUpdating}
      auth={state.auth}
      sendPromptError={sessionsState.sendPromptError}
      onSendPrompt={sessionsState.sendPrompt}
      creatingSession={sessionsState.creatingSession}
      sessionNotice={sessionsState.sessionNotice}
      onCreateSession={sessionsState.createSession}
      onContinueSession={sessionsState.continueSession}
      onCancelSessionRun={sessionsState.cancelSessionRun}
      onUpdateSessionSettings={sessionsState.updateSessionSettings}
      pendingApproval={sessionsState.pendingApproval}
      onResolveApproval={sessionsState.resolveApproval}
    />
  );
}
