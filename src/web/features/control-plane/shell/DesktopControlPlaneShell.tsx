import { NavLink } from 'react-router';
import type { ReactNode } from 'react';
import type { ControlPlaneState } from '../../../lib/api';
import type { ScreenshotMode } from '../../../lib/debug/layoutSnapshot';
import { RuntimeHostStrip, StatusBadge, WorkspacePathLabel, WorkspaceSwitcher } from '../components/common';
import { projectRuntimeHostSurface } from '../host-surface';
import type { ControlPlaneSection } from '../routes';

export function DesktopControlPlaneShell({
  state,
  error,
  activeSection,
  sessionPath,
  children,
  onRefresh,
  onSetActiveWorkspace,
  onCaptureDebugSnapshot,
}: {
  state?: ControlPlaneState;
  error?: string;
  activeSection: ControlPlaneSection;
  sessionPath: string;
  children: ReactNode;
  onRefresh: () => void;
  onSetActiveWorkspace: (workspaceId: string) => void;
  onCaptureDebugSnapshot: (screenshot: ScreenshotMode) => void;
}) {
  const host = projectRuntimeHostSurface(state);

  return (
    <main className="app-shell">
      <header className="toolbar">
        <nav className="tabs toolbar-tabs" aria-label="Control plane sections">
          <RouteTabLink active={activeSection === 'overview'} to="/overview">Overview</RouteTabLink>
          <RouteTabLink active={activeSection === 'sessions'} to={sessionPath}>Sessions</RouteTabLink>
          <RouteTabLink active={activeSection === 'tasks'} to="/tasks">Tasks</RouteTabLink>
          <RouteTabLink active={activeSection === 'workspaces'} to="/workspaces">Workspaces</RouteTabLink>
        </nav>
        <div className="toolbar-status">
          <div className="toolbar-actions">
            <DebugSnapshotMenu onCapture={onCaptureDebugSnapshot} />
          </div>
          <div className="topbar-title-row">
            <p className="topbar-eyebrow">Heddle Control Plane</p>
            <WorkspaceSwitcher state={state} onSelect={onSetActiveWorkspace} />
            <WorkspacePathLabel state={state} />
          </div>
          <StatusBadge error={error} state={state} />
        </div>
      </header>

      {(error || host.state === 'stale') ? <RuntimeHostStrip state={state} onRefresh={onRefresh} /> : null}
      {children}
    </main>
  );
}

function RouteTabLink({ active, to, children }: { active: boolean; to: string; children: string }) {
  return (
    <NavLink
      className={`tab-button ${active ? 'active' : ''}`}
      to={to}
      aria-current={active ? 'page' : undefined}
      data-testid={`nav-${children.toLowerCase()}`}
    >
      {children}
    </NavLink>
  );
}

function DebugSnapshotMenu({ onCapture }: { onCapture: (screenshot: ScreenshotMode) => void }) {
  return (
    <details className="debug-snapshot-menu">
      <summary className="debug-button">Snapshot</summary>
      <div className="debug-snapshot-options" role="menu" aria-label="Debug layout snapshot options">
        <button type="button" role="menuitem" onClick={() => onCapture('none')}>
          DOM + layout only
        </button>
        <button type="button" role="menuitem" onClick={() => onCapture('auto')}>
          Include screenshot
        </button>
      </div>
    </details>
  );
}
