import type { ControlPlaneState } from '../../../lib/api';
import { AddWorkspaceCard } from '../components/workspaces-screen/AddWorkspaceCard';
import { AttachedWorkspacesCard } from '../components/workspaces-screen/AttachedWorkspacesCard';
import { RecentWorkspacesCard } from '../components/workspaces-screen/RecentWorkspacesCard';
import { buildRecentWorkspaces } from '../components/workspaces-screen/workspaceScreenUtils';
import type { WorkspaceCreateInput } from '../components/workspaces-screen/types';

export { AddWorkspaceCard } from '../components/workspaces-screen/AddWorkspaceCard';

export function WorkspacesScreen({
  state,
  creatingWorkspace = false,
  renamingWorkspaceId,
  onCreateWorkspace,
  onRenameWorkspace,
  onSetActiveWorkspace,
}: {
  state: ControlPlaneState;
  creatingWorkspace?: boolean;
  renamingWorkspaceId?: string;
  onCreateWorkspace?: (input: WorkspaceCreateInput) => Promise<void>;
  onRenameWorkspace?: (workspaceId: string, name: string) => Promise<void>;
  onSetActiveWorkspace?: (workspaceId: string) => void;
}) {
  const recentWorkspaces = buildRecentWorkspaces(state);

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-4 overflow-x-hidden overflow-y-auto px-3 pt-3 pb-[calc(env(safe-area-inset-bottom)+5.5rem)] sm:px-4 sm:pt-4 sm:pb-4">
      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.8fr)]">
        <AttachedWorkspacesCard
          state={state}
          renamingWorkspaceId={renamingWorkspaceId}
          onRenameWorkspace={onRenameWorkspace}
          onSetActiveWorkspace={onSetActiveWorkspace}
        />

        <div className="grid min-w-0 gap-4">
          <AddWorkspaceCard
            creatingWorkspace={creatingWorkspace}
            recentWorkspaces={recentWorkspaces}
            onCreateWorkspace={onCreateWorkspace}
          />
          <RecentWorkspacesCard
            state={state}
            recentWorkspaces={recentWorkspaces}
            creatingWorkspace={creatingWorkspace}
            onCreateWorkspace={onCreateWorkspace}
            onSetActiveWorkspace={onSetActiveWorkspace}
          />
        </div>
      </div>
    </section>
  );
}
