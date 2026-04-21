import type { ReactNode } from 'react';
import type { ControlPlaneState } from '../../../lib/api';
import { className, shortPath } from '../utils';

export function Panel({
  title,
  children,
  wide = false,
  panelClassName,
}: {
  title: string;
  children: ReactNode;
  wide?: boolean;
  panelClassName?: string;
}) {
  return (
    <section className={className('panel', wide && 'wide', panelClassName)}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      <p className="muted">{body}</p>
    </div>
  );
}

export function StatusBadge({ error, state }: { error?: string; state?: ControlPlaneState }) {
  if (error) {
    return <aside className="status-badge bad">Error: {error}</aside>;
  }
  if (!state) {
    return <aside className="status-badge">Connecting...</aside>;
  }
  return <aside className="status-badge">{state.sessions.length} sessions · {state.heartbeat.tasks.length} tasks</aside>;
}

export function WorkspacePathLabel({ state }: { state?: ControlPlaneState }) {
  if (!state) {
    return null;
  }

  return (
    <span className="workspace-path-label">
      {state.workspace.name}
      <span className="muted"> · {shortPath(state.workspace.anchorRoot)}</span>
    </span>
  );
}

export function WorkspaceSwitcher({
  state,
  disabled,
  onSelect,
}: {
  state?: ControlPlaneState;
  disabled?: boolean;
  onSelect: (workspaceId: string) => void;
}) {
  if (!state || state.workspaces.length <= 1) {
    return null;
  }

  return (
    <label className="workspace-switcher">
      <span className="muted">Workspace</span>
      <select
        value={state.activeWorkspaceId}
        disabled={disabled}
        onChange={(event) => onSelect(event.target.value)}
      >
        {state.workspaces.map((workspace) => (
          <option key={workspace.id} value={workspace.id}>
            {workspace.name}
          </option>
        ))}
      </select>
    </label>
  );
}

export function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button className={className('tab-button', active && 'active')} type="button" onClick={onClick}>
      {children}
    </button>
  );
}

export function Pill({ children, tone }: { children: ReactNode; tone?: 'good' | 'warn' | 'bad' }) {
  return <span className={className('pill', tone)}>{children}</span>;
}

export function CodeBlock({ children }: { children: ReactNode }) {
  return <pre className="code-block">{children}</pre>;
}

export function WorkspaceSectionHeader({ title, subtitle, actions }: { title: string; subtitle: string; actions?: ReactNode }) {
  return (
    <header className="workspace-header">
      <div>
        <h2>{title}</h2>
        <p className="muted">{subtitle}</p>
      </div>
      {actions}
    </header>
  );
}

export function SideSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="side-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}
