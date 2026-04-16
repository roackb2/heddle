import type { ReactNode } from 'react';
import type { ControlPlaneState } from '../../../lib/api';
import { className, shortPath } from '../utils';

export function Panel({ title, children, wide = false }: { title: string; children: ReactNode; wide?: boolean }) {
  return (
    <section className={className('panel', wide && 'wide')}>
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

  return <span className="workspace-path-label">{shortPath(state.workspaceRoot)}</span>;
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
