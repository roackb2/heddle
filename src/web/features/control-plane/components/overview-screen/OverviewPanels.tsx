import type { ReactNode } from 'react';
import { Badge } from '../../../../components/ui/badge';
import type { ControlPlaneState } from '../../../../lib/api';
import { formatNumber, formatShortDate, short, shortPath, toneFor } from '../../utils';

export function OverviewCard({ children, className = '', ...props }: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLElement>) {
  return (
    <section className={`min-w-0 rounded-2xl border border-border bg-card/95 p-4 shadow-sm sm:p-5 ${className}`} {...props}>
      {children}
    </section>
  );
}

export function OverviewStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-border bg-background/60 p-3">
      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">{label}</p>
      <p className="mt-2 text-3xl font-semibold leading-none text-foreground sm:text-4xl">{value}</p>
    </div>
  );
}

export function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <dt className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">{label}</dt>
      <dd className="break-all text-sm text-foreground">{children}</dd>
    </div>
  );
}

export function OverviewSessionItem({
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

export function OverviewRunItem({
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

export function OverviewMemoryRunItem({
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

export function ToneBadge({ value }: { value: string }) {
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

export { formatNumber, shortPath };
