import { useEffect, useState, type ReactNode } from 'react';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { browseWorkspaceDirectories, type ControlPlaneState, type WorkspaceDirectoryListing } from '../../../lib/api';
import { formatNumber, shortPath } from '../utils';

type WorkspaceCreateInput = { name: string; anchorRoot: string; setActive: boolean };
type WorkspaceListItem = ControlPlaneState['workspaces'][number] & {
  relation: 'attached' | 'known';
};

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
        <WorkspaceCard>
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Workspace management</p>
              <h2 className="text-xl font-semibold text-foreground">Attached workspaces</h2>
              <p className="mt-1 text-sm text-muted-foreground">Switch, rename, and inspect workspaces attached to this control-plane catalog.</p>
            </div>
            <Badge variant="outline">{formatNumber(state.workspaces.length)} local</Badge>
          </div>

          <div className="space-y-3">
            {state.workspaces.map((workspace) => (
              <article
                key={workspace.id}
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

function WorkspaceRenameForm({
  workspaceId,
  initialName,
  disabled,
  pending,
  onRename,
}: {
  workspaceId: string;
  initialName: string;
  disabled?: boolean;
  pending?: boolean;
  onRename?: (workspaceId: string, name: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState(initialName);

  useEffect(() => {
    setDraft(initialName);
  }, [initialName]);

  const changed = draft.trim() && draft.trim() !== initialName;
  return (
    <form
      className="flex gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!onRename || !changed) {
          return;
        }
        void onRename(workspaceId, draft.trim());
      }}
    >
      <input
        className="h-10 min-w-0 flex-1 rounded-md border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        disabled={disabled}
        aria-label="Workspace name"
      />
      <Button type="submit" variant="outline" size="sm" disabled={disabled || !changed}>
        {pending ? 'Saving…' : 'Rename'}
      </Button>
    </form>
  );
}

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

function RecentWorkspacesCard({
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
        <div className="mt-4 space-y-2">
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

function WorkspacePickerDialog({
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
  const [browsePath, setBrowsePath] = useState<string | undefined>(selectedPath.trim() || undefined);
  const [pathInput, setPathInput] = useState(selectedPath.trim());
  const [listing, setListing] = useState<WorkspaceDirectoryListing | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [includeHidden, setIncludeHidden] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }

    const initialPath = selectedPath.trim() || undefined;
    setBrowsePath(initialPath);
    setPathInput(initialPath ?? '');
  }, [open, selectedPath]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onOpenChange(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onOpenChange]);

  useEffect(() => {
    if (!open) {
      return;
    }

    let cancelled = false;
    setLoading(true);
    void browseWorkspaceDirectories(browsePath, includeHidden)
      .then((next) => {
        if (cancelled) {
          return;
        }
        setListing(next);
        setBrowsePath(next.path);
        setPathInput(next.path);
        setError(undefined);
      })
      .catch((nextError) => {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : String(nextError));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [open, browsePath, includeHidden]);

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

function WorkspaceFolderRow({
  label,
  detail,
  entry,
  onOpen,
  onSelect,
}: {
  label: string;
  detail: string;
  entry?: WorkspaceDirectoryListing['entries'][number];
  onOpen: () => void;
  onSelect?: () => void;
}) {
  return (
    <div className="grid gap-3 border-b border-border p-3 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <button type="button" className="min-w-0 text-left" onClick={onOpen}>
        <span className="block truncate text-sm font-semibold text-foreground">{label}</span>
        <span className="mt-1 block truncate text-xs text-muted-foreground">{detail}</span>
        {entry ?
          <span className="mt-2 flex flex-wrap gap-1">
            {entry.hasHeddleState ? <Badge variant="secondary">Heddle workspace</Badge> : null}
            {entry.hasGit ? <Badge variant="outline">git repo</Badge> : null}
            {entry.hasPackageJson ? <Badge variant="outline">package.json</Badge> : null}
          </span>
        : null}
      </button>
      <div className="flex gap-2 sm:justify-end">
        <Button type="button" variant="ghost" size="sm" onClick={onOpen}>Open</Button>
        {onSelect ?
          <Button type="button" variant="outline" size="sm" onClick={onSelect}>Select</Button>
        : null}
      </div>
    </div>
  );
}

function WorkspaceMeta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <dt className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">{label}</dt>
      <dd className="break-all text-sm text-foreground">{children}</dd>
    </div>
  );
}

function WorkspaceCard({ children }: { children: ReactNode }) {
  return (
    <section className="min-w-0 rounded-2xl border border-border bg-card/95 p-4 shadow-sm sm:p-5">
      {children}
    </section>
  );
}

function buildRecentWorkspaces(state: ControlPlaneState): WorkspaceListItem[] {
  const byStateRoot = new Map<string, WorkspaceListItem>();
  for (const workspace of state.workspaces) {
    byStateRoot.set(workspace.stateRoot, { ...workspace, relation: 'attached' });
  }
  for (const workspace of state.knownWorkspaces ?? []) {
    if (!byStateRoot.has(workspace.stateRoot)) {
      byStateRoot.set(workspace.stateRoot, { ...workspace, relation: 'known' });
    }
  }
  return Array.from(byStateRoot.values()).sort((left, right) => {
    const activeScore = Number(right.id === state.activeWorkspaceId) - Number(left.id === state.activeWorkspaceId);
    if (activeScore !== 0) {
      return activeScore;
    }
    return (right.updatedAt ?? '').localeCompare(left.updatedAt ?? '');
  });
}

function workspaceNameFromPath(path: string): string {
  const normalized = path.trim().replace(/\/+$/, '');
  return normalized.split('/').filter(Boolean).at(-1) ?? normalized;
}
