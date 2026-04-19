import type { ReactNode } from 'react';
import type { ControlPlaneState } from '../../../lib/api';
import type { ScreenshotMode } from '../../../lib/debug/layoutSnapshot';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { shortPath } from '../utils';

export type ControlPlaneTab = 'overview' | 'sessions' | 'heartbeat';

type MobileControlPlaneShellProps = {
  tab: ControlPlaneTab;
  onTabChange: (tab: ControlPlaneTab) => void;
  state?: ControlPlaneState;
  error?: string;
  children: ReactNode;
  onCaptureDebugSnapshot?: (screenshot: ScreenshotMode) => void;
};

const tabs: Array<{ value: ControlPlaneTab; label: string }> = [
  { value: 'sessions', label: 'Sessions' },
  { value: 'heartbeat', label: 'Tasks' },
  { value: 'overview', label: 'Overview' },
];

export function MobileControlPlaneShell({
  tab,
  onTabChange,
  state,
  error,
  children,
  onCaptureDebugSnapshot,
}: MobileControlPlaneShellProps) {
  return (
    <main className="flex h-dvh flex-col overflow-hidden bg-background pt-[env(safe-area-inset-top)] text-foreground">
      <header className="shrink-0 border-b border-border bg-card/95 px-3 py-2">
        <div className="flex min-w-0 items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="m-0 text-base font-semibold leading-5 tracking-normal">Heddle</h1>
              <MobileStatusBadge state={state} error={error} />
            </div>
            <p className="m-0 truncate text-xs leading-5 text-muted-foreground">
              {state ? shortPath(state.workspaceRoot) : 'Reading workspace state'}
            </p>
          </div>
          {onCaptureDebugSnapshot ? <MobileSnapshotMenu onCapture={onCaptureDebugSnapshot} /> : null}
        </div>
      </header>

      <section className="min-h-0 flex-1 overflow-auto bg-background">
        {children}
      </section>

      <nav
        className="grid shrink-0 grid-cols-3 gap-1 border-t border-border bg-card/95 px-2 py-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)]"
        aria-label="Control plane sections"
      >
        {tabs.map((item) => (
          <Button
            key={item.value}
            type="button"
            variant={tab === item.value ? 'secondary' : 'ghost'}
            size="sm"
            className="h-9 rounded-md px-2 text-xs"
            onClick={() => onTabChange(item.value)}
            aria-current={tab === item.value ? 'page' : undefined}
          >
            {item.label}
          </Button>
        ))}
      </nav>
    </main>
  );
}

function MobileStatusBadge({ state, error }: { state?: ControlPlaneState; error?: string }) {
  if (error) {
    return <Badge variant="destructive">Error</Badge>;
  }

  if (!state) {
    return <Badge variant="outline">Connecting</Badge>;
  }

  return <Badge variant="secondary">{state.sessions.length} sessions</Badge>;
}

function MobileSnapshotMenu({ onCapture }: { onCapture: (screenshot: ScreenshotMode) => void }) {
  return (
    <details className="relative">
      <summary className="flex h-9 cursor-pointer list-none items-center rounded-md border border-border bg-secondary px-3 text-xs font-medium text-secondary-foreground marker:hidden">
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
