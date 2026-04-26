import type { ReactNode } from 'react';
import type { ControlPlaneState } from '../../../lib/api';
import type { ScreenshotMode } from '../../../lib/debug/layoutSnapshot';
import { Button } from '../../../components/ui/button';
import { shortPath } from '../utils';
import { projectRuntimeHostSurface } from '../host-surface';
import type { ControlPlaneSection } from '../routes';

type MobileControlPlaneShellProps = {
  section: ControlPlaneSection;
  onSectionChange: (section: ControlPlaneSection) => void;
  state?: ControlPlaneState;
  error?: string;
  children: ReactNode;
  onCaptureDebugSnapshot?: (screenshot: ScreenshotMode) => void;
  onSetActiveWorkspace?: (workspaceId: string) => void;
  onRefresh?: () => void;
};

const tabs: Array<{ value: ControlPlaneSection; label: string }> = [
  { value: 'overview', label: 'Overview' },
  { value: 'sessions', label: 'Sessions' },
  { value: 'tasks', label: 'Tasks' },
  { value: 'workspaces', label: 'Workspaces' },
];

export function MobileControlPlaneShell({
  section,
  onSectionChange,
  state,
  error,
  children,
  onCaptureDebugSnapshot,
  onSetActiveWorkspace,
  onRefresh,
}: MobileControlPlaneShellProps) {
  const host = error ?
    {
      state: 'stale' as const,
      label: 'Error',
      badgeLabel: 'Error',
      detail: error,
      tone: 'destructive' as const,
      endpoint: undefined,
    }
  : projectRuntimeHostSurface(state);
  return (
    <main className="flex h-dvh flex-col overflow-hidden bg-background pt-[env(safe-area-inset-top)] text-foreground">
      <header className="shrink-0 border-b border-border bg-card/95 px-4 py-3">
        <div className="flex min-w-0 items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold tracking-normal text-foreground">Heddle</span>
            </div>
            <p className="m-0 truncate text-xs leading-5 text-muted-foreground">
              {state ? `${state.workspace.name} · ${shortPath(state.workspace.anchorRoot)}` : 'Reading workspace state'}
            </p>
            {state && state.workspaces.length > 1 && onSetActiveWorkspace ?
              <label className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                <span>Workspace</span>
                <select
                  className="h-7 min-w-0 rounded-md border border-border bg-background px-2 text-[11px] text-foreground"
                  value={state.activeWorkspaceId}
                  onChange={(event) => onSetActiveWorkspace(event.target.value)}
                >
                  {state.workspaces.map((workspace) => (
                    <option key={workspace.id} value={workspace.id}>
                      {workspace.name}
                    </option>
                  ))}
                </select>
              </label>
            : null}
          </div>
          <div className="flex items-center gap-2">
            {onCaptureDebugSnapshot ? <MobileSnapshotMenu onCapture={onCaptureDebugSnapshot} /> : null}
          </div>
        </div>
        {(error || host.state === 'stale') ?
          <div className="mt-2 flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            <span className="truncate">{host.detail}</span>
            {host.endpoint ? <span className="shrink-0">endpoint={host.endpoint}</span> : null}
            {onRefresh ? <button type="button" className="text-[11px] text-accent" onClick={onRefresh}>Refresh</button> : null}
          </div>
        : null}
      </header>

      <section className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto bg-background">
        {children}
      </section>

      <nav
        className="grid shrink-0 grid-cols-4 gap-1 border-t border-border bg-card/95 px-3 py-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)]"
        aria-label="Control plane sections"
      >
        {tabs.map((item) => (
          <Button
            key={item.value}
            type="button"
            variant={section === item.value ? 'secondary' : 'ghost'}
            size="sm"
            className="h-9 rounded-md px-2 text-xs"
            onClick={() => onSectionChange(item.value)}
            aria-current={section === item.value ? 'page' : undefined}
            data-testid={`mobile-nav-${item.value}`}
          >
            {item.label}
          </Button>
        ))}
      </nav>
    </main>
  );
}

function MobileSnapshotMenu({ onCapture }: { onCapture: (screenshot: ScreenshotMode) => void }) {
  return (
    <details className="relative">
      <summary className="flex h-10 cursor-pointer list-none items-center rounded-md border border-border bg-secondary px-3 text-xs font-medium text-secondary-foreground marker:hidden">
        Snapshot
      </summary>
      <div className="absolute right-0 top-11 z-50 grid min-w-44 gap-1 rounded-md border border-border bg-popover p-1 shadow-lg">
        <button
          type="button"
          className="rounded-md px-3 py-2 text-left text-xs text-popover-foreground hover:bg-accent hover:text-accent-foreground"
          onClick={() => onCapture('none')}
        >
          DOM only
        </button>
        <button
          type="button"
          className="rounded-md px-3 py-2 text-left text-xs text-popover-foreground hover:bg-accent hover:text-accent-foreground"
          onClick={() => onCapture('auto')}
        >
          With screenshot
        </button>
      </div>
    </details>
  );
}
