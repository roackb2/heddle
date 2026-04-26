import { useMemo, type ReactNode } from 'react';
import { Badge } from '../../../components/ui/badge';
import type { ControlPlaneState } from '../../../lib/api';
import { projectRuntimeHostSurface } from '../host-surface';
import { formatNumber, formatShortDate, short, shortPath, toneFor } from '../utils';

export function OverviewScreen({
  state,
}: {
  state: ControlPlaneState;
}) {
  const recentSessions = useMemo(() => state.sessions.slice(0, 3), [state.sessions]);
  const recentRuns = useMemo(() => state.heartbeat.runs.slice(0, 3), [state.heartbeat.runs]);
  const recentMemoryRuns = useMemo(() => state.memory.runs.latest.slice(0, 3), [state.memory.runs.latest]);
  const runtimeHost = projectRuntimeHostSurface(state);

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-4 overflow-x-hidden overflow-y-auto px-3 pt-3 pb-[calc(env(safe-area-inset-bottom)+5.5rem)] sm:px-4 sm:pt-4 sm:pb-4">
      <div className="min-w-0 grid gap-4 lg:grid-cols-2">
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
