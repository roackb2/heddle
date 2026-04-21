import type { ReactNode } from 'react';
import type { ControlPlaneState } from '../../../lib/api';
import { className, shortPath } from '../utils';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../../../components/ui/tooltip';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../../../components/ui/popover';
import { projectRuntimeHostSurface, type RuntimeHostSurface } from '../host-surface';

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

export function RuntimeHostBadge({ state }: { state?: ControlPlaneState }) {
  const host = projectRuntimeHostSurface(state);
  return <Badge variant={host.tone}>{host.badgeLabel}</Badge>;
}

export function RuntimeHostInfo({ state }: { state?: ControlPlaneState }) {
  const host = projectRuntimeHostSurface(state);
  return (
    <TooltipProvider delayDuration={120}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="runtime-host-info-button"
            aria-label="Explain runtime host state"
          >
            i
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="end" className="w-80 rounded-lg border border-border bg-popover px-3 py-3 text-popover-foreground shadow-lg">
          <RuntimeHostInfoContent host={host} />
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function RuntimeHostMobileInfo({ state }: { state?: ControlPlaneState }) {
  const host = projectRuntimeHostSurface(state);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="runtime-host-info-button" aria-label="Explain runtime host state">
          i
        </button>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start" className="w-[min(280px,calc(100vw-32px))] rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-lg">
        <RuntimeHostInfoContent host={host} />
      </PopoverContent>
    </Popover>
  );
}

export function RuntimeHostStrip({
  state,
  onRefresh,
}: {
  state?: ControlPlaneState;
  onRefresh?: () => void;
}) {
  const host = projectRuntimeHostSurface(state);

  return (
    <section className="mx-4 mt-4 flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-card/95 px-4 py-3 shadow-sm sm:mx-5">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex min-w-0 items-center gap-2">
            <p className="truncate text-sm font-semibold text-foreground">{host.label}</p>
            <Badge variant={host.tone} className="w-fit shrink-0">{state?.workspace.name ?? 'workspace'}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">{host.detail}</p>
        </div>
        {onRefresh ? <Button type="button" variant="outline" size="sm" onClick={onRefresh}>Refresh state</Button> : null}
      </div>
      {host.endpoint || host.ownerId || host.lastSeenAt ?
        <div className="flex min-w-0 flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {host.endpoint ? <span>endpoint={host.endpoint}</span> : null}
          {host.ownerId ? <span>owner={host.ownerId}</span> : null}
          {host.lastSeenAt ? <span>last seen={new Date(host.lastSeenAt).toLocaleTimeString()}</span> : null}
        </div>
      : null}
    </section>
  );
}

function RuntimeHostInfoContent({ host }: { host: RuntimeHostSurface }) {
  return (
    <div className="runtime-host-info-copy">
      <strong>{host.label}</strong>
      <p>{host.detail}</p>
      {host.endpoint ? <p>endpoint={host.endpoint}</p> : null}
      {host.ownerId ? <p>owner={host.ownerId}</p> : null}
      {host.lastSeenAt ? <p>last seen={new Date(host.lastSeenAt).toLocaleTimeString()}</p> : null}
    </div>
  );
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
