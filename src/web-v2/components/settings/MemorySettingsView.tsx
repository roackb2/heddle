import dayjs from 'dayjs';
import type { ControlPlaneMemoryStatus } from '@web/api/client';
import { useI18n } from '@web/i18n';
import { cn } from '@web/lib/utils';

export interface MemorySettingsViewProps {
  status?: ControlPlaneMemoryStatus;
  loading: boolean;
  error?: string;
}

const statusToneClasses = {
  good: 'border-emerald-400/45 bg-emerald-950/80 text-emerald-50',
  muted: 'border-border bg-muted/20 text-muted-foreground',
  warning: 'border-primary/40 bg-primary/10 text-foreground',
  danger: 'border-destructive/45 bg-destructive/10 text-destructive',
} satisfies Record<'danger' | 'good' | 'muted' | 'warning', string>;

export function MemorySettingsView({ status, loading, error }: MemorySettingsViewProps) {
  const { t } = useI18n();
  const latestRun = status?.runs.latest[0];

  if (loading && !status) {
    return <MemorySettingsEmpty title={t('memorySettings.loadingTitle')} body={t('memorySettings.loadingBody')} />;
  }

  if (error && !status) {
    return <MemorySettingsEmpty title={t('memorySettings.errorTitle')} body={error} />;
  }

  return (
    <div className="v2-scrollbar-hidden h-full min-w-0 overflow-auto">
      <div className="v2-memory-settings mx-auto flex w-full max-w-3xl flex-col gap-6 px-8 py-8">
        <section className="min-w-0">
          <div className="mb-3 flex min-w-0 items-center justify-between gap-3">
            <h2 className="v2-type-section-label text-muted-foreground">{t('memorySettings.healthTitle')}</h2>
            <MemoryStatusPill
              label={status?.catalog.ok ? t('memorySettings.statusOk') : t('memorySettings.statusAttention')}
              tone={status?.catalog.ok ? 'good' : 'danger'}
            />
          </div>
          <dl className="v2-settings-group">
            <MemorySettingsRow
              label={t('memorySettings.catalog')}
              value={status?.catalog.ok ? t('memorySettings.catalogHealthy') : t('memorySettings.catalogIncomplete')}
              detail={formatMissingCatalogs(status?.catalog.missing, t('memorySettings.noMissingCatalogs'))}
            />
            <MemorySettingsRow
              label={t('memorySettings.notes')}
              value={formatNumber(status?.notes.count)}
              detail={t('memorySettings.notesDetail')}
            />
            <MemorySettingsRow
              label={t('memorySettings.pending')}
              value={formatNumber(status?.candidates.pending)}
              detail={status?.candidates.pending ? t('memorySettings.pendingDetail') : t('memorySettings.noPendingDetail')}
            />
          </dl>
        </section>

        <section className="min-w-0">
          <h2 className="v2-type-section-label mb-3 text-muted-foreground">{t('memorySettings.maintenanceTitle')}</h2>
          <div className="v2-settings-group">
            {latestRun ? (
              <article className="v2-settings-row">
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <p className="v2-type-body-strong min-w-0 truncate text-foreground">{latestRun.id}</p>
                    <MemoryStatusPill label={latestRun.outcome} tone={toneForOutcome(latestRun.outcome)} />
                  </div>
                  <p className="v2-type-panel-subtitle mt-1 text-muted-foreground">{formatTimestamp(latestRun.finishedAt)}</p>
                  <p className="v2-type-panel-subtitle mt-2 line-clamp-2 text-pretty text-muted-foreground">{latestRun.summary}</p>
                </div>
              </article>
            ) : (
              <MemorySettingsRow
                label={t('memorySettings.latestRun')}
                value={t('memorySettings.noRuns')}
                detail={t('memorySettings.noRunsDetail')}
              />
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function MemorySettingsRow({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="v2-settings-row">
      <dt className="v2-type-nav-primary min-w-0 text-foreground">{label}</dt>
      <dd className="min-w-0 text-right">
        <p className="v2-type-body-strong tabular-nums text-foreground">{value}</p>
        <p className="v2-type-caption mt-1 text-muted-foreground">{detail}</p>
      </dd>
    </div>
  );
}

function MemoryStatusPill({
  label,
  tone,
}: {
  label: string;
  tone: keyof typeof statusToneClasses;
}) {
  return (
    <span className={cn('v2-type-caption shrink-0 rounded-sm border px-1.5 py-0.5 tabular-nums', statusToneClasses[tone])}>
      {label}
    </span>
  );
}

function MemorySettingsEmpty({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex h-full min-h-0 items-center justify-center px-6">
      <div className="max-w-sm text-center">
        <p className="v2-type-body-strong text-foreground">{title}</p>
        <p className="v2-type-panel-subtitle mt-1 text-pretty text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}

function formatNumber(value: number | undefined): string {
  return (value ?? 0).toLocaleString();
}

function formatTimestamp(value: string): string {
  return dayjs(value).format('MMM D, YYYY HH:mm');
}

function formatMissingCatalogs(missing: string[] | undefined, fallback: string): string {
  if (!missing?.length) {
    return fallback;
  }

  return missing.slice(0, 3).join(', ');
}

function toneForOutcome(outcome: string): keyof typeof statusToneClasses {
  if (outcome === 'done') {
    return 'good';
  }
  if (outcome === 'failed' || outcome === 'error') {
    return 'danger';
  }
  if (outcome === 'skipped') {
    return 'muted';
  }
  return 'warning';
}
