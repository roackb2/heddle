import { useCallback, useEffect, useState } from 'react';
import './control-plane.css';
import { saveLayoutSnapshot, type ControlPlaneState } from '../../lib/api';
import { captureControlPlaneLayoutSnapshot, type ScreenshotMode } from '../../lib/debug/layoutSnapshot';
import { useControlPlaneState } from './hooks/useControlPlaneState';
import { useHeartbeatWorkspace } from './hooks/useHeartbeatWorkspace';
import { useIsMobile } from './hooks/useIsMobile';
import { useSessionWorkspace } from './hooks/useSessionWorkspace';
import { Panel, StatusBadge, TabButton, WorkspacePathLabel } from './components/common';
import { HeartbeatWorkspace } from './components/HeartbeatWorkspace';
import { OverviewView } from './components/OverviewView';
import { SessionsWorkspace } from './components/SessionsWorkspace';
import { MobileControlPlaneShell, type ControlPlaneTab } from './mobile/MobileControlPlaneShell';
import { Toaster } from '../../components/ui/toaster';
import { useToast } from '../../components/ui/use-toast';

type Tab = ControlPlaneTab;

declare global {
  interface Window {
    __HEDDLE_CAPTURE_LAYOUT_SNAPSHOT?: (options?: { screenshot?: ScreenshotMode }) => Promise<void>;
  }
}

export function ControlPlaneApp() {
  const [tab, setTab] = useState<Tab>('sessions');
  const { state, error, refresh } = useControlPlaneState();
  const { toasts, toast: notifyToast } = useToast();
  const isMobile = useIsMobile();
  const refreshControlPlaneState = useCallback(() => {
    void refresh();
  }, [refresh]);
  const sessionWorkspace = useSessionWorkspace(state?.sessions, notifyToast, refreshControlPlaneState);
  const heartbeatWorkspace = useHeartbeatWorkspace(state?.heartbeat.tasks, state?.heartbeat.runs);
  const captureDebugSnapshot = useCallback(async (screenshot: ScreenshotMode) => {
    let snapshot: Awaited<ReturnType<typeof captureControlPlaneLayoutSnapshot>> | undefined;
    try {
      snapshot = await captureControlPlaneLayoutSnapshot({
        screenshot,
        context: {
          activeTab: tab,
          selectedSessionId: sessionWorkspace.selectedSessionId,
          selectedTurnId: sessionWorkspace.selectedTurnId,
          runActive: sessionWorkspace.sendingPrompt || sessionWorkspace.runInFlight,
          pendingApproval: sessionWorkspace.pendingApproval,
          selectedModel: sessionWorkspace.sessionDetail?.model ?? sessionWorkspace.activeSession?.model,
          driftEnabled: sessionWorkspace.sessionDetail?.driftEnabled ?? sessionWorkspace.activeSession?.driftEnabled,
          driftLevel: sessionWorkspace.sessionDetail?.driftLevel ?? sessionWorkspace.activeSession?.driftLevel,
          toastCount: toasts.length,
          latestToasts: toasts.map((toast) => ({ title: toast.title, tone: toast.tone })),
          errors: [error, sessionWorkspace.sessionDetailError, sessionWorkspace.sendPromptError, sessionWorkspace.turnReviewError]
            .filter((candidate): candidate is string => Boolean(candidate)),
        },
      });
      const saved = await saveLayoutSnapshot(snapshot);
      notifyToast({
        title: 'Layout snapshot saved',
        body: saved.screenshotPath ? `${saved.jsonPath}\n${saved.screenshotPath}` : saved.jsonPath,
        tone: 'success',
      });
    } catch (snapshotError) {
      const message = snapshotError instanceof Error ? snapshotError.message : String(snapshotError);
      if (snapshot) {
        downloadLayoutSnapshot(snapshot);
      }
      notifyToast({
        title: snapshot ? 'Layout snapshot downloaded' : 'Layout snapshot failed',
        body: snapshot ? `Server save failed, downloaded locally. ${message}` : message,
        tone: snapshot ? 'info' : 'error',
      });
    }
  }, [error, notifyToast, sessionWorkspace, tab, toasts]);

  useEffect(() => {
    if (!import.meta.env.DEV) {
      return undefined;
    }

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

  const sectionTabs = (
    <>
      <TabButton active={tab === 'overview'} onClick={() => setTab('overview')}>Overview</TabButton>
      <TabButton active={tab === 'sessions'} onClick={() => setTab('sessions')}>Sessions</TabButton>
      <TabButton active={tab === 'heartbeat'} onClick={() => setTab('heartbeat')}>Tasks</TabButton>
    </>
  );
  const debugSnapshotMenu = import.meta.env.DEV ?
    <details className="debug-snapshot-menu">
      <summary className="debug-button">Snapshot</summary>
      <div className="debug-snapshot-options" role="menu" aria-label="Debug layout snapshot options">
        <button type="button" role="menuitem" onClick={() => void captureDebugSnapshot('none')}>
          DOM + layout only
        </button>
        <button type="button" role="menuitem" onClick={() => void captureDebugSnapshot('auto')}>
          Include screenshot
        </button>
      </div>
    </details>
  : null;

  const activeContent = !state ?
    <Panel title="Loading state">
      <p className="muted">{error ?? 'Reading local Heddle state...'}</p>
    </Panel>
  : renderActiveTab(tab, state, sessionWorkspace, heartbeatWorkspace);

  if (isMobile) {
    return (
      <>
        <MobileControlPlaneShell
          tab={tab}
          onTabChange={setTab}
          state={state}
          error={error}
          onCaptureDebugSnapshot={import.meta.env.DEV ? (screenshot) => void captureDebugSnapshot(screenshot) : undefined}
        >
          {activeContent}
        </MobileControlPlaneShell>
        <Toaster />
      </>
    );
  }

  return (
    <main className="app-shell">
      <header className="toolbar">
        <nav className="tabs toolbar-tabs" aria-label="Control plane sections">
          {sectionTabs}
        </nav>
        <div className="toolbar-debug">
          {debugSnapshotMenu}
        </div>
        <div className="toolbar-status">
          <div className="topbar-title-row">
            <p className="topbar-eyebrow">Heddle Control Plane</p>
            <WorkspacePathLabel state={state} />
          </div>
          <StatusBadge error={error} state={state} />
        </div>
      </header>

      {activeContent}
      <Toaster />
    </main>
  );
}

function downloadLayoutSnapshot(snapshot: Awaited<ReturnType<typeof captureControlPlaneLayoutSnapshot>>) {
  const timestamp = snapshot.capturedAt.replaceAll(':', '-');
  const prefix = `${timestamp}-${snapshot.appState.activeTab}`;
  downloadTextFile(`${prefix}.json`, `${JSON.stringify(snapshot, null, 2)}\n`, 'application/json');
  if (snapshot.screenshot.status === 'captured') {
    downloadDataUrl(`${prefix}.png`, snapshot.screenshot.dataUrl);
  }
}

function downloadTextFile(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  try {
    downloadUrl(filename, url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function downloadDataUrl(filename: string, dataUrl: string) {
  downloadUrl(filename, dataUrl);
}

function downloadUrl(filename: string, url: string) {
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
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
