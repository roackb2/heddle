import { useState } from 'react';
import { Button } from '../../../../components/ui/button';
import { workspaceNameFromPath } from './workspaceScreenUtils';
import { WorkspaceCard } from './WorkspaceCard';
import { WorkspacePickerDialog } from './WorkspacePickerDialog';
import type { WorkspaceCreateInput, WorkspaceListItem } from './types';

export function AddWorkspaceCard({
  creatingWorkspace,
  onCreateWorkspace,
  recentWorkspaces = [],
}: {
  creatingWorkspace: boolean;
  onCreateWorkspace?: (input: WorkspaceCreateInput) => Promise<void>;
  recentWorkspaces?: WorkspaceListItem[];
}) {
  const [name, setName] = useState('');
  const [anchorRoot, setAnchorRoot] = useState('');
  const [setActive, setSetActive] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <WorkspaceCard>
      <div className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Add workspace</p>
        <h2 className="text-xl font-semibold text-foreground">Choose a project</h2>
        <p className="text-sm text-muted-foreground">Register another workspace path and optionally switch the control plane to it.</p>
      </div>

      <form
        data-testid="workspace-create-form"
        className="mt-4 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!onCreateWorkspace || !name.trim() || !anchorRoot.trim()) {
            return;
          }

          void onCreateWorkspace({
            name: name.trim(),
            anchorRoot: anchorRoot.trim(),
            setActive,
          }).then(() => {
            setName('');
            setAnchorRoot('');
            setSetActive(true);
          });
        }}
      >
        <label className="block space-y-2">
          <span className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Name</span>
          <input
            className="h-11 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Workspace name"
            disabled={creatingWorkspace}
            data-testid="workspace-create-name"
          />
        </label>

        <label className="block space-y-2">
          <span className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Workspace path</span>
          <div className="flex gap-2">
            <input
              className="h-11 min-w-0 flex-1 rounded-md border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground"
              value={anchorRoot}
              onChange={(event) => setAnchorRoot(event.target.value)}
              placeholder="/absolute/path/to/workspace"
              disabled={creatingWorkspace}
              data-testid="workspace-create-path"
            />
            <Button
              type="button"
              variant="outline"
              className="h-11 shrink-0"
              disabled={creatingWorkspace}
              onClick={() => setPickerOpen(true)}
            >
              Choose…
            </Button>
          </div>
        </label>

        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={setActive}
            onChange={(event) => setSetActive(event.target.checked)}
            disabled={creatingWorkspace}
          />
          <span>Switch to this workspace after creating it</span>
        </label>

        <Button
          type="submit"
          variant="secondary"
          className="w-full"
          disabled={creatingWorkspace || !name.trim() || !anchorRoot.trim()}
          data-testid="workspace-create-submit"
        >
          {creatingWorkspace ? 'Creating…' : 'Create workspace'}
        </Button>
      </form>
      <WorkspacePickerDialog
        open={pickerOpen}
        selectedPath={anchorRoot}
        recentWorkspaces={recentWorkspaces}
        onOpenChange={setPickerOpen}
        onSelectPath={(path) => {
          setAnchorRoot(path);
          if (!name.trim()) {
            setName(workspaceNameFromPath(path));
          }
        }}
      />
    </WorkspaceCard>
  );
}
