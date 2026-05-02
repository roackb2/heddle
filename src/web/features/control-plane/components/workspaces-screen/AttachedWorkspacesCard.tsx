import { Badge } from '../../../../components/ui/badge';
import { Button } from '../../../../components/ui/button';
import type { ControlPlaneState } from '../../../../lib/api';
import { formatNumber } from '../../utils';
import { WorkspaceCard } from './WorkspaceCard';
import { WorkspaceMeta } from './WorkspaceMeta';
import { WorkspaceRenameForm } from './WorkspaceRenameForm';

export function AttachedWorkspacesCard({
  state,
  renamingWorkspaceId,
  onRenameWorkspace,
  onSetActiveWorkspace,
}: {
  state: ControlPlaneState;
  renamingWorkspaceId?: string;
  onRenameWorkspace?: (workspaceId: string, name: string) => Promise<void>;
  onSetActiveWorkspace?: (workspaceId: string) => void;
}) {
  return (
    <WorkspaceCard>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Workspace management</p>
          <h2 className="text-xl font-semibold text-foreground">Attached workspaces</h2>
          <p className="mt-1 text-sm text-muted-foreground">Switch, rename, and inspect workspaces attached to this control-plane catalog.</p>
        </div>
        <Badge variant="outline">{formatNumber(state.workspaces.length)} local</Badge>
      </div>

      <div className="space-y-3" data-testid="workspace-list">
        {state.workspaces.map((workspace) => (
          <article
            key={workspace.id}
            data-testid={`workspace-card-${workspace.id}`}
            className="rounded-xl border border-border bg-background/60 p-4"
          >
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="truncate text-base font-semibold text-foreground">{workspace.name}</h3>
                  {workspace.id === state.activeWorkspaceId ? <Badge variant="secondary">active</Badge> : null}
                  <Badge variant="outline">{workspace.id}</Badge>
                </div>
                <dl className="mt-3 grid gap-2 text-sm">
                  <WorkspaceMeta label="Workspace path">{workspace.anchorRoot}</WorkspaceMeta>
                  <WorkspaceMeta label="State path">{workspace.stateRoot}</WorkspaceMeta>
                  <WorkspaceMeta label="Repo roots">{workspace.repoRoots.join(', ')}</WorkspaceMeta>
                </dl>
              </div>

              <div className="flex min-w-[min(100%,260px)] flex-col gap-3">
                <WorkspaceRenameForm
                  workspaceId={workspace.id}
                  initialName={workspace.name}
                  disabled={!onRenameWorkspace || renamingWorkspaceId === workspace.id}
                  pending={renamingWorkspaceId === workspace.id}
                  onRename={onRenameWorkspace}
                />
                <Button
                  type="button"
                  variant={workspace.id === state.activeWorkspaceId ? 'secondary' : 'outline'}
                  disabled={workspace.id === state.activeWorkspaceId || !onSetActiveWorkspace}
                  onClick={() => onSetActiveWorkspace?.(workspace.id)}
                >
                  {workspace.id === state.activeWorkspaceId ? 'Current workspace' : 'Switch to workspace'}
                </Button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </WorkspaceCard>
  );
}
