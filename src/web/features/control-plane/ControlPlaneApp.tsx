import { useCallback, useState } from 'react';
import './control-plane.css';
import { type ControlPlaneState } from '../../lib/api';
import { useControlPlaneState } from './hooks/useControlPlaneState';
import { useHeartbeatWorkspace } from './hooks/useHeartbeatWorkspace';
import { useSessionWorkspace } from './hooks/useSessionWorkspace';
import { Panel, StatusBadge, TabButton, WorkspacePathLabel } from './components/common';
import { HeartbeatWorkspace } from './components/HeartbeatWorkspace';
import { OverviewView } from './components/OverviewView';
import { SessionsWorkspace } from './components/SessionsWorkspace';
import { ToastViewport, useToasts } from './components/toasts';

type Tab = 'overview' | 'sessions' | 'heartbeat';

export function ControlPlaneApp() {
  const [tab, setTab] = useState<Tab>('sessions');
  const { state, error, refresh } = useControlPlaneState();
  const { toasts, addToast, removeToast } = useToasts();
  const refreshControlPlaneState = useCallback(() => {
    void refresh();
  }, [refresh]);
  const sessionWorkspace = useSessionWorkspace(state?.sessions, addToast, refreshControlPlaneState);
  const heartbeatWorkspace = useHeartbeatWorkspace(state?.heartbeat.tasks, state?.heartbeat.runs);
  const sectionTabs = (
    <>
      <TabButton active={tab === 'overview'} onClick={() => setTab('overview')}>Overview</TabButton>
      <TabButton active={tab === 'sessions'} onClick={() => setTab('sessions')}>Sessions</TabButton>
      <TabButton active={tab === 'heartbeat'} onClick={() => setTab('heartbeat')}>Tasks</TabButton>
    </>
  );

  return (
    <main className="app-shell">
      <header className="toolbar">
        <nav className="tabs toolbar-tabs" aria-label="Control plane sections">
          {sectionTabs}
        </nav>
        <div className="toolbar-status">
          <div className="topbar-title-row">
            <p className="topbar-eyebrow">Heddle Control Plane</p>
            <WorkspacePathLabel state={state} />
          </div>
          <StatusBadge error={error} state={state} />
        </div>
      </header>

      {!state ?
        <Panel title="Loading state">
          <p className="muted">{error ?? 'Reading local Heddle state...'}</p>
        </Panel>
      : renderActiveTab(tab, state, sessionWorkspace, heartbeatWorkspace)}
      <ToastViewport toasts={toasts} onDismiss={removeToast} />
    </main>
  );
}

function renderActiveTab(
  tab: Tab,
  state: ControlPlaneState,
  sessionWorkspace: ReturnType<typeof useSessionWorkspace>,
  heartbeatWorkspace: ReturnType<typeof useHeartbeatWorkspace>,
) {
  if (tab === 'overview') {
    return <OverviewView state={state} />;
  }

  if (tab === 'sessions') {
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

  return (
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
    />
  );
}
