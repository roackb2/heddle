import { Badge } from '../../../../components/ui/badge';
import type { ControlPlaneState } from '../../../../lib/api';
import { shortPath } from '../../utils';
import { WorkspaceCard } from './WorkspaceCard';
import type { WorkspaceCreateInput, WorkspaceListItem } from './types';

export function RecentWorkspacesCard({
  state,
  recentWorkspaces,
  creatingWorkspace,
  onCreateWorkspace,
  onSetActiveWorkspace,
}: {
  state: ControlPlaneState;
  recentWorkspaces: WorkspaceListItem[];
  creatingWorkspace: boolean;
  onCreateWorkspace?: (input: WorkspaceCreateInput) => Promise<void>;
  onSetActiveWorkspace?: (workspaceId: string) => void;
}) {
  return (
    <WorkspaceCard>
      <div className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Recent workspaces</p>
        <h2 className="text-xl font-semibold text-foreground">Open workspace</h2>
        <p className="text-sm text-muted-foreground">Workspaces Heddle has seen on this machine, including the current catalog.</p>
      </div>

      {recentWorkspaces.length ?
        <div className="mt-4 space-y-2" data-testid="recent-workspace-list">
          {recentWorkspaces.slice(0, 8).map((workspace) => {
            const active = workspace.id === state.activeWorkspaceId;
            const attached = workspace.relation === 'attached';
            return (
              <button
                key={workspace.stateRoot}
                type="button"
                className="w-full rounded-xl border border-border bg-background/60 p-3 text-left hover:border-primary disabled:cursor-not-allowed disabled:opacity-50"
                disabled={creatingWorkspace || active || (attached ? !onSetActiveWorkspace : !onCreateWorkspace)}
                onClick={() => {
                  if (attached) {
                    onSetActiveWorkspace?.(workspace.id);
                  } else {
                    void onCreateWorkspace?.({
                      name: workspace.name,
                      anchorRoot: workspace.anchorRoot,
                      setActive: true,
                    });
                  }
                }}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="block truncate text-sm font-semibold text-foreground">{workspace.name}</span>
                  {active ? <Badge variant="secondary">active</Badge> : null}
                  <Badge variant="outline">{attached ? 'attached' : 'known'}</Badge>
                </span>
                <span className="mt-1 block truncate text-xs text-muted-foreground">{workspace.anchorRoot}</span>
                <span className="mt-2 block text-[11px] text-muted-foreground">{shortPath(workspace.stateRoot)}</span>
              </button>
            );
          })}
        </div>
      : <p className="mt-4 text-sm text-muted-foreground">No Heddle workspaces are known yet. Run Heddle in a project once, then refresh.</p>}
    </WorkspaceCard>
  );
}
