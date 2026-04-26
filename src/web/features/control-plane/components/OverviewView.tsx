import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { browseWorkspaceDirectories, type ControlPlaneState, type WorkspaceDirectoryListing } from '../../../lib/api';
import { projectRuntimeHostSurface } from '../host-surface';
import { formatNumber, formatShortDate, short, shortPath, toneFor } from '../utils';

export function OverviewView({
  state,
  creatingWorkspace = false,
  onCreateWorkspace,
}: {
  state: ControlPlaneState;
  creatingWorkspace?: boolean;
  onCreateWorkspace?: (input: { name: string; anchorRoot: string; setActive: boolean }) => Promise<void>;
}) {
  const recentSessions = useMemo(() => state.sessions.slice(0, 3), [state.sessions]);
  const recentRuns = useMemo(() => state.heartbeat.runs.slice(0, 3), [state.heartbeat.runs]);
  const recentMemoryRuns = useMemo(() => state.memory.runs.latest.slice(0, 3), [state.memory.runs.latest]);
  const runtimeHost = projectRuntimeHostSurface(state);

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-4 overflow-x-hidden overflow-y-auto px-3 pt-3 pb-[calc(env(safe-area-inset-bottom)+5.5rem)] sm:px-4 sm:pt-4 sm:pb-4">
      <div className="min-w-0 grid gap-4 lg:grid-cols-4">
        <OverviewCard className="lg:col-span-1">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Active workspace</p>
              <h2 className="text-xl font-semibold text-foreground">{state.workspace.name}</h2>
              <p className="text-sm text-muted-foreground">{shortPath(state.workspace.anchorRoot)}</p>
            </div>
            <Badge variant="secondary" className="w-fit max-w-full truncate">{state.workspace.id}</Badge>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-3">
            <OverviewStat label="Repos" value={formatNumber(state.workspace.repoRoots.length)} />
            <OverviewStat label="Sessions" value={formatNumber(state.sessions.length)} />
            <OverviewStat label="Tasks" value={formatNumber(state.heartbeat.tasks.length)} />
          </div>

          <dl className="mt-4 grid gap-3 text-sm">
            <MetaRow label="Workspace path">{state.workspace.anchorRoot}</MetaRow>
            <MetaRow label="State path">{state.workspace.stateRoot}</MetaRow>
          </dl>
        </OverviewCard>

        <OverviewCard className="lg:col-span-1">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Runtime host</p>
              <h2 className="text-xl font-semibold text-foreground">{runtimeHost.label}</h2>
              <p className="text-sm text-muted-foreground">{runtimeHost.detail}</p>
            </div>
            <Badge variant={runtimeHost.tone} className="w-fit max-w-full truncate">
              {runtimeHost.state}
            </Badge>
          </div>

          {state.runtimeHost ?
            <dl className="mt-4 grid gap-3 text-sm">
              <MetaRow label="Endpoint">
                {state.runtimeHost.endpoint.host}:{state.runtimeHost.endpoint.port}
              </MetaRow>
              <MetaRow label="Owner">{state.runtimeHost.ownerId}</MetaRow>
              <MetaRow label="Last seen">{state.runtimeHost.workspaceOwner?.lastSeenAt ?? 'unknown'}</MetaRow>
              <MetaRow label="Registry">{state.runtimeHost.registryPath}</MetaRow>
            </dl>
          : <p className="mt-4 text-sm text-muted-foreground">Daemon metadata is not loaded in this control-plane session.</p>}
        </OverviewCard>

        <WorkspaceCreateCard creatingWorkspace={creatingWorkspace} onCreateWorkspace={onCreateWorkspace} />
        <KnownWorkspacesCard state={state} creatingWorkspace={creatingWorkspace} onCreateWorkspace={onCreateWorkspace} />
      </div>

      <div className="min-w-0 grid gap-4 xl:grid-cols-3">
        <OverviewCard className="min-h-0">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Recent sessions</p>
              <h2 className="text-xl font-semibold text-foreground">Latest conversations</h2>
            </div>
            <Badge variant="outline">{formatNumber(state.sessions.length)} total</Badge>
          </div>

          {recentSessions.length ?
            <div className="space-y-3">
              {recentSessions.map((session) => (
                <OverviewSessionItem key={session.id} session={session} />
              ))}
            </div>
          : <p className="text-sm text-muted-foreground">No saved sessions yet.</p>}

          {state.sessions.length > recentSessions.length ?
            <p className="mt-4 text-sm text-muted-foreground">Open Sessions to browse the full conversation catalog.</p>
          : null}
        </OverviewCard>

        <OverviewCard className="min-h-0">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Recent task runs</p>
              <h2 className="text-xl font-semibold text-foreground">Heartbeat activity</h2>
            </div>
            <Badge variant="outline">{formatNumber(state.heartbeat.tasks.length)} tasks</Badge>
          </div>

          {recentRuns.length ?
            <div className="space-y-3">
              {recentRuns.map((run) => (
                <OverviewRunItem key={run.id} run={run} />
              ))}
            </div>
          : <p className="text-sm text-muted-foreground">No heartbeat runs recorded yet.</p>}

          {state.heartbeat.runs.length > recentRuns.length ?
            <p className="mt-4 text-sm text-muted-foreground">Open Tasks to inspect the full run history.</p>
          : null}
        </OverviewCard>

        <OverviewCard className="min-h-0">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Workspace memory</p>
              <h2 className="text-xl font-semibold text-foreground">Catalog health</h2>
            </div>
            <Badge variant={state.memory.catalog.ok ? 'secondary' : 'destructive'}>
              {state.memory.catalog.ok ? 'ok' : 'attention'}
            </Badge>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <OverviewStat label="Notes" value={formatNumber(state.memory.notes.count)} />
            <OverviewStat label="Pending" value={formatNumber(state.memory.candidates.pending)} />
          </div>

          {state.memory.catalog.missing.length ?
            <div className="mt-4 rounded-xl border border-border bg-background/60 p-3">
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Missing catalogs</p>
              <p className="mt-2 text-sm text-muted-foreground">{state.memory.catalog.missing.slice(0, 4).join(', ')}</p>
            </div>
          : null}

          {recentMemoryRuns.length ?
            <div className="mt-4 space-y-3">
              {recentMemoryRuns.map((run) => (
                <OverviewMemoryRunItem key={run.id} run={run} />
              ))}
            </div>
          : <p className="mt-4 text-sm text-muted-foreground">No memory maintenance runs recorded yet.</p>}
        </OverviewCard>
      </div>
    </section>
  );
}

function WorkspaceCreateCard({
  creatingWorkspace,
  onCreateWorkspace,
}: {
  creatingWorkspace: boolean;
  onCreateWorkspace?: (input: { name: string; anchorRoot: string; setActive: boolean }) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [anchorRoot, setAnchorRoot] = useState('');
  const [setActive, setSetActive] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <OverviewCard className="lg:col-span-1">
      <div className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Quick action</p>
        <h2 className="text-xl font-semibold text-foreground">Add workspace</h2>
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
        onOpenChange={setPickerOpen}
        onSelectPath={(path) => {
          setAnchorRoot(path);
          if (!name.trim()) {
            setName(workspaceNameFromPath(path));
          }
        }}
      />
    </OverviewCard>
  );
}

function WorkspacePickerDialog({
  open,
  selectedPath,
  onOpenChange,
  onSelectPath,
}: {
  open: boolean;
  selectedPath: string;
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
            {loading ? <span className="text-sm text-muted-foreground">Loading…</span> : null}
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

function workspaceNameFromPath(path: string): string {
  const normalized = path.trim().replace(/\/+$/, '');
  return normalized.split('/').filter(Boolean).at(-1) ?? normalized;
}

function KnownWorkspacesCard({
  state,
  creatingWorkspace,
  onCreateWorkspace,
}: {
  state: ControlPlaneState;
  creatingWorkspace: boolean;
  onCreateWorkspace?: (input: { name: string; anchorRoot: string; setActive: boolean }) => Promise<void>;
}) {
  const knownWorkspaces = state.knownWorkspaces ?? [];

  return (
    <OverviewCard className="lg:col-span-1">
      <div className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Known workspaces</p>
        <h2 className="text-xl font-semibold text-foreground">Switch project</h2>
        <p className="text-sm text-muted-foreground">Workspaces recently opened by Heddle on this machine.</p>
      </div>

      {knownWorkspaces.length ?
        <div className="mt-4 space-y-2">
          {knownWorkspaces.slice(0, 5).map((workspace) => (
            <button
              key={workspace.stateRoot}
              type="button"
              className="w-full rounded-xl border border-border bg-background/60 p-3 text-left hover:border-primary disabled:cursor-not-allowed disabled:opacity-50"
              disabled={creatingWorkspace || !onCreateWorkspace}
              onClick={() => {
                void onCreateWorkspace?.({
                  name: workspace.name,
                  anchorRoot: workspace.anchorRoot,
                  setActive: true,
                });
              }}
            >
              <span className="block truncate text-sm font-semibold text-foreground">{workspace.name}</span>
              <span className="mt-1 block truncate text-xs text-muted-foreground">{workspace.anchorRoot}</span>
            </button>
          ))}
        </div>
      : <p className="mt-4 text-sm text-muted-foreground">No other Heddle workspaces are registered yet. Run Heddle in another project once, then refresh.</p>}
    </OverviewCard>
  );
}

function OverviewCard({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <section className={`min-w-0 rounded-2xl border border-border bg-card/95 p-4 shadow-sm sm:p-5 ${className}`}>
      {children}
    </section>
  );
}

function OverviewStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-border bg-background/60 p-3">
      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">{label}</p>
      <p className="mt-2 text-3xl font-semibold leading-none text-foreground sm:text-4xl">{value}</p>
    </div>
  );
}

function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <dt className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">{label}</dt>
      <dd className="break-all text-sm text-foreground">{children}</dd>
    </div>
  );
}

function OverviewSessionItem({
  session,
}: {
  session: ControlPlaneState['sessions'][number];
}) {
  return (
    <article className="rounded-xl border border-border bg-background/60 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold text-foreground">{session.name}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{formatShortDate(session.updatedAt)}</p>
        </div>
        <div className="flex min-w-0 flex-wrap gap-2 sm:max-w-[48%] sm:justify-end">
          <Badge variant="outline" className="max-w-full truncate">{session.model ?? 'unset model'}</Badge>
          <Badge variant="secondary" className="w-fit">{session.turnCount} turns</Badge>
        </div>
      </div>
      {session.lastSummary ? <p className="mt-3 text-sm text-muted-foreground">{short(session.lastSummary, 120)}</p> : null}
    </article>
  );
}

function OverviewRunItem({
  run,
}: {
  run: ControlPlaneState['heartbeat']['runs'][number];
}) {
  return (
    <article className="rounded-xl border border-border bg-background/60 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold text-foreground">{run.id}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{formatShortDate(run.createdAt)}</p>
        </div>
        <div className="flex min-w-0 flex-wrap gap-2 sm:max-w-[48%] sm:justify-end">
          <ToneBadge value={run.status} />
          <ToneBadge value={run.decision} />
        </div>
      </div>
      <p className="mt-3 text-sm text-muted-foreground">{short(run.summary, 132)}</p>
    </article>
  );
}

function OverviewMemoryRunItem({
  run,
}: {
  run: ControlPlaneState['memory']['runs']['latest'][number];
}) {
  return (
    <article className="rounded-xl border border-border bg-background/60 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold text-foreground">{run.id}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{formatShortDate(run.finishedAt)}</p>
        </div>
        <ToneBadge value={run.outcome} />
      </div>
      <p className="mt-3 text-sm text-muted-foreground">{short(run.summary, 132)}</p>
    </article>
  );
}

function ToneBadge({ value }: { value: string }) {
  const tone = toneFor(value);
  if (tone === 'good') {
    return <Badge className="max-w-full truncate border-emerald-400/45 bg-emerald-950/90 text-emerald-50">{value}</Badge>;
  }
  if (tone === 'warn') {
    return <Badge className="max-w-full truncate border-cyan-400/40 bg-primary/5 text-foreground">{value}</Badge>;
  }
  if (tone === 'bad') {
    return <Badge className="max-w-full truncate border-red-300/45 bg-red-950/92 text-red-50">{value}</Badge>;
  }
  return <Badge variant="outline" className="max-w-full truncate">{value}</Badge>;
}
