import { Badge } from '../../../../components/ui/badge';
import { Button } from '../../../../components/ui/button';
import { useWorkspacePicker } from '../../hooks/workspaces-screen/useWorkspacePicker';
import { WorkspaceFolderRow } from './WorkspaceFolderRow';
import type { WorkspaceListItem } from './types';

export function WorkspacePickerDialog({
  open,
  selectedPath,
  recentWorkspaces,
  onOpenChange,
  onSelectPath,
}: {
  open: boolean;
  selectedPath: string;
  recentWorkspaces: WorkspaceListItem[];
  onOpenChange: (open: boolean) => void;
  onSelectPath: (path: string) => void;
}) {
  const {
    browsePath,
    setBrowsePath,
    pathInput,
    setPathInput,
    listing,
    error,
    loading,
    includeHidden,
    setIncludeHidden,
  } = useWorkspacePicker({ open, selectedPath, onOpenChange });

  if (!open) {
    return null;
  }

  const currentPath = listing?.path ?? browsePath ?? selectedPath.trim();
  const useCurrentFolder = () => {
    if (!currentPath) {
      return;
    }
    onSelectPath(currentPath);
    onOpenChange(false);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm sm:p-6"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onOpenChange(false);
        }
      }}
    >
      <div className="flex max-h-[min(820px,92vh)] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl" role="dialog" aria-modal="true" aria-label="Choose workspace folder">
        <div className="border-b border-border px-4 py-4 sm:px-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Workspace folder</p>
              <h2 className="mt-1 text-xl font-semibold text-foreground">Choose a project root</h2>
              <p className="mt-1 text-sm text-muted-foreground">Navigate folders, pick a repo or existing Heddle workspace, then switch the control plane to it.</p>
            </div>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          </div>

          <form
            className="mt-4 flex flex-col gap-2 sm:flex-row"
            onSubmit={(event) => {
              event.preventDefault();
              setBrowsePath(pathInput.trim() || undefined);
            }}
          >
            <input
              className="h-11 min-w-0 flex-1 rounded-md border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground"
              value={pathInput}
              onChange={(event) => setPathInput(event.target.value)}
              placeholder="/absolute/path/to/workspace"
            />
            <Button type="submit" variant="outline" className="h-11">Go</Button>
            <Button type="button" variant="secondary" className="h-11" disabled={!currentPath} onClick={useCurrentFolder}>
              Use this folder
            </Button>
          </form>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          {recentWorkspaces.length ?
            <div className="mb-4 rounded-xl border border-border bg-background/50 p-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Recent workspaces</p>
                  <p className="mt-1 text-sm text-muted-foreground">Choose from Heddle workspaces seen on this machine.</p>
                </div>
                <Badge variant="outline">{recentWorkspaces.length}</Badge>
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                {recentWorkspaces.slice(0, 6).map((workspace) => (
                  <button
                    key={workspace.stateRoot}
                    type="button"
                    className="rounded-lg border border-border bg-card px-3 py-2 text-left hover:border-primary"
                    onClick={() => {
                      onSelectPath(workspace.anchorRoot);
                      onOpenChange(false);
                    }}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="block truncate text-sm font-semibold text-foreground">{workspace.name}</span>
                      <Badge variant="outline">{workspace.relation}</Badge>
                    </span>
                    <span className="mt-1 block truncate text-xs text-muted-foreground">{workspace.anchorRoot}</span>
                  </button>
                ))}
              </div>
            </div>
          : null}

          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="max-w-full truncate">{currentPath || 'Home'}</Badge>
            {listing?.parentPath ?
              <Button type="button" variant="ghost" size="sm" onClick={() => setBrowsePath(listing.parentPath)}>
                Up one level
              </Button>
            : null}
            <label className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={includeHidden}
                onChange={(event) => setIncludeHidden(event.target.checked)}
              />
              <span>Show hidden folders</span>
            </label>
            {loading ? <span className="text-sm text-muted-foreground">Loading...</span> : null}
          </div>

          {error ? <div className="mb-3 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div> : null}

          <div className="overflow-hidden rounded-xl border border-border bg-background/40">
            {listing?.parentPath ?
              <WorkspaceFolderRow
                label=".."
                detail={listing.parentPath}
                onOpen={() => setBrowsePath(listing.parentPath)}
              />
            : null}
            {listing?.entries.map((entry) => (
              <WorkspaceFolderRow
                key={entry.path}
                label={entry.name}
                detail={entry.path}
                entry={entry}
                onOpen={() => setBrowsePath(entry.path)}
                onSelect={() => {
                  onSelectPath(entry.path);
                  onOpenChange(false);
                }}
              />
            ))}
            {listing && !loading && listing.entries.length === 0 ?
              <div className="p-4 text-sm text-muted-foreground">No readable child folders found here. You can still use the current folder.</div>
            : null}
          </div>
        </div>
      </div>
    </div>
  );
}
