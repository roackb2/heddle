import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import './control-plane.css';
import type { ControlPlaneState } from '../../lib/api';
import type { ScreenshotMode } from '../../lib/debug/layoutSnapshot';
import { useControlPlaneState } from './hooks/useControlPlaneState';
import { useControlPlaneRouting } from './hooks/useControlPlaneRouting';
import { useDebugSnapshot } from './hooks/useDebugSnapshot';
import { useHeartbeatWorkspace } from './hooks/useHeartbeatWorkspace';
import { useIsMobile } from './hooks/useIsMobile';
import { useSessionWorkspace } from './hooks/useSessionWorkspace';
import { useWorkspaceActions } from './hooks/useWorkspaceActions';
import { Panel } from './components/common';
import { ControlPlaneDesktopShell } from './components/ControlPlaneDesktopShell';
import { HeartbeatWorkspace } from './components/HeartbeatWorkspace';
import { OverviewView } from './components/OverviewView';
import { SessionsWorkspace } from './components/SessionsWorkspace';
import { WorkspaceManagementView } from './components/WorkspaceManagementView';
import { MobileControlPlaneShell } from './mobile/MobileControlPlaneShell';
import { Toaster } from '../../components/ui/toaster';
import { useToast } from '../../components/ui/use-toast';
import { useControlPlaneUiStore } from './state/controlPlaneUiStore';

declare global {
  interface Window {
    __HEDDLE_CAPTURE_LAYOUT_SNAPSHOT?: (options?: { screenshot?: ScreenshotMode }) => Promise<void>;
  }
}

export function ControlPlaneApp() {
  const routing = useControlPlaneRouting();
  const { state, error, refresh, setActiveWorkspace, createWorkspace, renameWorkspace } = useControlPlaneState();
  const { toasts, toast: notifyToast } = useToast();
  const inspectorTab = useControlPlaneUiStore((store) => store.inspectorTab);
  const setInspectorTab = useControlPlaneUiStore((store) => store.setInspectorTab);
  const isMobile = useIsMobile();
  const refreshControlPlaneState = () => {
    void refresh();
  };
  const sessionWorkspace = useSessionWorkspace(state?.sessions, notifyToast, refreshControlPlaneState, {
    selectedSessionId: routing.routeSessionId,
    onSelectedSessionIdChange: routing.setRouteSessionId,
    inspectorTab,
    onInspectorTabChange: setInspectorTab,
    autoSelectSession: routing.tab === 'sessions',
  });
  const heartbeatWorkspace = useHeartbeatWorkspace(
    state?.heartbeat.tasks,
    state?.heartbeat.runs,
    notifyToast,
    refreshControlPlaneState,
  );
  const workspaceActions = useWorkspaceActions({
    state,
    setActiveWorkspace,
    createWorkspace,
    renameWorkspace,
    notify: notifyToast,
  });
  const captureDebugSnapshot = useDebugSnapshot({
    tab: routing.tab,
    sessionWorkspace,
    error,
    toasts,
    notify: notifyToast,
  });

  useEffect(() => {
    routing.normalizeRoute();
  }, [routing]);

  useEffect(() => {
    window.__HEDDLE_CAPTURE_LAYOUT_SNAPSHOT = async (options) => {
      await captureDebugSnapshot(options?.screenshot ?? 'none');
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
      void captureDebugSnapshot('none');
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      if (window.__HEDDLE_CAPTURE_LAYOUT_SNAPSHOT) {
        delete window.__HEDDLE_CAPTURE_LAYOUT_SNAPSHOT;
      }
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [captureDebugSnapshot]);

  const activeContent = !state ?
    <Panel title="Loading state">
      <p className="muted">{error ?? 'Reading local Heddle state...'}</p>
    </Panel>
  : renderActiveTab(state, sessionWorkspace, heartbeatWorkspace, workspaceActions);

  if (isMobile) {
    return (
      <>
        <MobileControlPlaneShell
          tab={routing.tab}
          onTabChange={routing.setTab}
          state={state}
          error={error}
          onSetActiveWorkspace={(workspaceId) => void workspaceActions.switchWorkspace(workspaceId)}
          onCaptureDebugSnapshot={(screenshot) => void captureDebugSnapshot(screenshot)}
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
      <ControlPlaneDesktopShell
        activeTab={routing.tab}
        sessionPath={routing.routeSessionId ? `/sessions/${encodeURIComponent(routing.routeSessionId)}` : '/sessions'}
        state={state}
        error={error}
        onSetActiveWorkspace={(workspaceId) => void workspaceActions.switchWorkspace(workspaceId)}
        onCaptureDebugSnapshot={(screenshot) => void captureDebugSnapshot(screenshot)}
        onRefresh={() => void refresh()}
      >
        {activeContent}
      </ControlPlaneDesktopShell>
      <Toaster />
    </>
  );
}

function renderActiveTab(
  state: ControlPlaneState,
  sessionWorkspace: ReturnType<typeof useSessionWorkspace>,
  heartbeatWorkspace: ReturnType<typeof useHeartbeatWorkspace>,
  workspaceActions: ReturnType<typeof useWorkspaceActions>,
) {
  return (
    <Routes>
      <Route path="/overview" element={<OverviewView state={state} />} />
      <Route path="/sessions" element={<SessionsRoute state={state} sessionWorkspace={sessionWorkspace} />} />
      <Route path="/sessions/:sessionId/*" element={<SessionsRoute state={state} sessionWorkspace={sessionWorkspace} />} />
      <Route
        path="/tasks"
        element={(
          <HeartbeatWorkspace
            tasks={state.heartbeat.tasks}
            runs={state.heartbeat.runs}
            selectedTask={heartbeatWorkspace.selectedTask}
            selectedTaskId={heartbeatWorkspace.selectedTaskId}
            onSelectTask={heartbeatWorkspace.setSelectedTaskId}
            selectedRun={heartbeatWorkspace.selectedRun}
            selectedRunId={heartbeatWorkspace.selectedRunId}
            onSelectRun={heartbeatWorkspace.setSelectedRunId}
            selectedTaskRuns={heartbeatWorkspace.selectedTaskRuns}
            pendingTaskAction={heartbeatWorkspace.pendingTaskAction}
            onEnableTask={heartbeatWorkspace.enableTask}
            onDisableTask={heartbeatWorkspace.disableTask}
            onTriggerTask={heartbeatWorkspace.triggerTask}
          />
        )}
      />
      <Route
        path="/workspaces"
        element={(
          <WorkspaceManagementView
            state={state}
            creatingWorkspace={workspaceActions.creatingWorkspace}
            renamingWorkspaceId={workspaceActions.renamingWorkspaceId}
            onCreateWorkspace={workspaceActions.createWorkspace}
            onRenameWorkspace={workspaceActions.renameWorkspace}
            onSetActiveWorkspace={(workspaceId) => void workspaceActions.switchWorkspace(workspaceId)}
          />
        )}
      />
      <Route path="*" element={<Navigate to="/overview" replace />} />
    </Routes>
  );
}

function SessionsRoute({
  state,
  sessionWorkspace,
}: {
  state: ControlPlaneState;
  sessionWorkspace: ReturnType<typeof useSessionWorkspace>;
}) {
  return (
    <SessionsWorkspace
      sessions={state.sessions}
      activeSession={sessionWorkspace.activeSession}
      sessionDetail={sessionWorkspace.sessionDetail}
      sessionDetailLoading={sessionWorkspace.sessionDetailLoading}
      sessionDetailError={sessionWorkspace.sessionDetailError}
      selectedSessionId={sessionWorkspace.selectedSessionId}
      onSelectSession={sessionWorkspace.setSelectedSessionId}
      selectedTurnId={sessionWorkspace.selectedTurnId}
      onSelectTurn={sessionWorkspace.setSelectedTurnId}
      selectedTurn={sessionWorkspace.selectedTurn}
      turnReview={sessionWorkspace.turnReview}
      turnReviewLoading={sessionWorkspace.turnReviewLoading}
      turnReviewError={sessionWorkspace.turnReviewError}
      sendingPrompt={sessionWorkspace.sendingPrompt}
      runInFlight={sessionWorkspace.runInFlight}
      memoryUpdating={sessionWorkspace.memoryUpdating}
      sendPromptError={sessionWorkspace.sendPromptError}
      onSendPrompt={sessionWorkspace.sendPrompt}
      creatingSession={sessionWorkspace.creatingSession}
      sessionNotice={sessionWorkspace.sessionNotice}
      onCreateSession={sessionWorkspace.createSession}
      onContinueSession={sessionWorkspace.continueSession}
      onCancelSessionRun={sessionWorkspace.cancelSessionRun}
      onUpdateSessionSettings={sessionWorkspace.updateSessionSettings}
      pendingApproval={sessionWorkspace.pendingApproval}
      onResolveApproval={sessionWorkspace.resolveApproval}
      inspectorTab={sessionWorkspace.inspectorTab}
      onInspectorTabChange={sessionWorkspace.setInspectorTab}
    />
  );
}
