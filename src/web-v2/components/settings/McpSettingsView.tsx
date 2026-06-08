import { useMemo, useState } from 'react';
import type { ControlPlaneMcpServerView, ControlPlaneMcpServers } from '@web/api/client';
import { Button } from '@web/components/ui/button';
import { Input } from '@web/components/ui/input';
import { Switch } from '@web/components/ui/switch';
import type { I18nMessageKey } from '@web/i18n';
import { useI18n } from '@web/i18n';
import { cn } from '@web/lib/utils';

export interface McpSettingsViewProps {
  mcp?: ControlPlaneMcpServers;
  loading: boolean;
  error?: string;
  updating: boolean;
  refreshing: boolean;
  onSetServerEnabled: (serverId: string, enabled: boolean) => Promise<void>;
  onRefreshServer: (serverId: string) => Promise<void>;
}

type McpServerStatus = ControlPlaneMcpServerView['status'];

const mcpStatusSections = [
  { status: 'enabled', labelKey: 'mcpSettings.sections.enabled', detailKey: 'mcpSettings.sectionDetails.enabled' },
  { status: 'available', labelKey: 'mcpSettings.sections.available', detailKey: 'mcpSettings.sectionDetails.available' },
  { status: 'disabled', labelKey: 'mcpSettings.sections.disabled', detailKey: 'mcpSettings.sectionDetails.disabled' },
  { status: 'missing', labelKey: 'mcpSettings.sections.missing', detailKey: 'mcpSettings.sectionDetails.missing' },
] satisfies { status: McpServerStatus; labelKey: I18nMessageKey; detailKey: I18nMessageKey }[];

const statusLabelKeys = {
  enabled: 'mcpSettings.status.enabled',
  available: 'mcpSettings.status.available',
  disabled: 'mcpSettings.status.disabled',
  missing: 'mcpSettings.status.missing',
  failed: 'mcpSettings.status.failed',
} satisfies Record<McpServerStatus, I18nMessageKey>;

const statusToneClasses = {
  enabled: 'border-primary/45 bg-primary/10 text-foreground',
  available: 'border-border bg-muted/20 text-muted-foreground',
  disabled: 'border-warning/45 bg-warning/10 text-foreground',
  missing: 'border-destructive/45 bg-destructive/10 text-destructive',
  failed: 'border-destructive/45 bg-destructive/10 text-destructive',
} satisfies Record<McpServerStatus, string>;

export function McpSettingsView({
  mcp,
  loading,
  error,
  updating,
  refreshing,
  onSetServerEnabled,
  onRefreshServer,
}: McpSettingsViewProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [pendingServerId, setPendingServerId] = useState<string | undefined>();
  const [refreshingServerId, setRefreshingServerId] = useState<string | undefined>();
  const [actionError, setActionError] = useState<string | undefined>();
  const allServers = useMemo(() => mcp?.servers ?? [], [mcp?.servers]);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleServers = useMemo(() => {
    if (!normalizedQuery) {
      return allServers;
    }

    return allServers.filter((server) => [
      server.id,
      server.config?.transport,
      server.config?.transport === 'stdio' ? server.config.command : server.config?.url,
      server.catalog?.serverName,
    ].some((value) => value?.toLocaleLowerCase().includes(normalizedQuery)));
  }, [allServers, normalizedQuery]);
  const counts = useMemo(() => ({
    enabled: allServers.filter((server) => server.status === 'enabled').length,
    available: allServers.filter((server) => server.status === 'available').length,
    disabled: allServers.filter((server) => server.status === 'disabled' || server.status === 'missing').length,
    issues: mcp?.issues.length ?? 0,
  }), [allServers, mcp?.issues.length]);

  async function setServerEnabled(serverId: string, enabled: boolean) {
    try {
      setActionError(undefined);
      setPendingServerId(serverId);
      await onSetServerEnabled(serverId, enabled);
    } catch (nextError) {
      setActionError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setPendingServerId(undefined);
    }
  }

  async function refreshServer(serverId: string) {
    try {
      setActionError(undefined);
      setRefreshingServerId(serverId);
      await onRefreshServer(serverId);
    } catch (nextError) {
      setActionError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setRefreshingServerId(undefined);
    }
  }

  if (loading && !mcp) {
    return <McpSettingsEmpty title={t('mcpSettings.loadingTitle')} body={t('mcpSettings.loadingBody')} />;
  }

  if (error && !mcp) {
    return <McpSettingsEmpty title={t('mcpSettings.errorTitle')} body={error} />;
  }

  return (
    <div className="v2-scrollbar-hidden h-full min-w-0 overflow-auto">
      <div className="v2-settings-page mx-auto flex w-full max-w-4xl flex-col gap-6 px-8 py-8">
        <section className="min-w-0">
          <div className="mb-3 flex min-w-0 flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <h2 className="v2-type-section-label text-muted-foreground">{t('mcpSettings.overviewTitle')}</h2>
              <p className="v2-type-panel-subtitle mt-1 truncate text-muted-foreground">
                {mcp?.configPath ?? t('mcpSettings.noConfig')}
              </p>
            </div>
            <Input
              aria-label={t('mcpSettings.searchLabel')}
              className="v2-control w-full sm:w-64"
              placeholder={t('mcpSettings.searchPlaceholder')}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <dl className="flex min-w-0 flex-wrap items-center gap-2">
            <McpMetricPill label={t('mcpSettings.metrics.enabled')} value={counts.enabled} detail={t('mcpSettings.metrics.enabledDetail')} />
            <McpMetricPill label={t('mcpSettings.metrics.available')} value={counts.available} detail={t('mcpSettings.metrics.availableDetail')} />
            <McpMetricPill label={t('mcpSettings.metrics.disabled')} value={counts.disabled} detail={t('mcpSettings.metrics.disabledDetail')} />
            <McpMetricPill label={t('mcpSettings.metrics.issues')} value={counts.issues} detail={t('mcpSettings.metrics.issuesDetail')} />
          </dl>
        </section>

        {actionError ? <McpSettingsAlert message={actionError} /> : null}

        <section className="min-w-0">
          <h2 className="v2-type-section-label mb-3 text-muted-foreground">{t('mcpSettings.catalogTitle')}</h2>
          <div className="flex flex-col gap-4">
            {mcpStatusSections.map((section) => (
              <McpSection
                key={section.status}
                detail={t(section.detailKey)}
                label={t(section.labelKey)}
                pendingServerId={pendingServerId}
                refreshingServerId={refreshingServerId}
                refreshing={refreshing}
                servers={visibleServers.filter((server) => server.status === section.status)}
                updating={updating}
                onRefreshServer={refreshServer}
                onSetServerEnabled={setServerEnabled}
              />
            ))}
          </div>
        </section>

        {mcp?.issues.length ? (
          <section className="min-w-0">
            <h2 className="v2-type-section-label mb-3 text-muted-foreground">{t('mcpSettings.issuesTitle')}</h2>
            <div className="v2-settings-group">
              {mcp.issues.map((issue) => (
                <div className="v2-settings-row" key={`${issue.code}:${issue.path}`}>
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <McpStatusPill label={issue.code} status="failed" />
                      <p className="v2-type-nav-primary min-w-0 truncate text-foreground">{issue.path}</p>
                    </div>
                    <p className="v2-type-caption mt-1 text-pretty text-muted-foreground">{issue.message}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}

function McpSection({
  detail,
  label,
  pendingServerId,
  refreshingServerId,
  refreshing,
  servers,
  updating,
  onRefreshServer,
  onSetServerEnabled,
}: {
  detail: string;
  label: string;
  pendingServerId?: string;
  refreshingServerId?: string;
  refreshing: boolean;
  servers: ControlPlaneMcpServerView[];
  updating: boolean;
  onRefreshServer: (serverId: string) => Promise<void>;
  onSetServerEnabled: (serverId: string, enabled: boolean) => Promise<void>;
}) {
  const { t } = useI18n();
  return (
    <div className="min-w-0">
      <div className="mb-2 flex min-w-0 items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="v2-type-nav-primary text-foreground">{label}</h3>
          <p className="v2-type-caption mt-0.5 truncate text-muted-foreground">{detail}</p>
        </div>
        <span className="v2-type-caption tabular-nums text-muted-foreground">{servers.length}</span>
      </div>
      <div className="v2-settings-group">
        {servers.length ? servers.map((server) => (
          <McpServerRow
            key={server.id}
            pending={pendingServerId === server.id}
            refreshing={refreshingServerId === server.id}
            server={server}
            updating={updating || refreshing}
            onRefreshServer={onRefreshServer}
            onSetServerEnabled={onSetServerEnabled}
          />
        )) : (
          <div className="v2-settings-row">
            <p className="v2-type-caption text-muted-foreground">{t('mcpSettings.emptySection')}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function McpServerRow({
  pending,
  refreshing,
  server,
  updating,
  onRefreshServer,
  onSetServerEnabled,
}: {
  pending: boolean;
  refreshing: boolean;
  server: ControlPlaneMcpServerView;
  updating: boolean;
  onRefreshServer: (serverId: string) => Promise<void>;
  onSetServerEnabled: (serverId: string, enabled: boolean) => Promise<void>;
}) {
  const { t } = useI18n();
  const enabled = server.status === 'enabled';
  const missing = server.status === 'missing';
  const label = enabled ? t('mcpSettings.disableAction') : t('mcpSettings.enableAction');
  const target = server.config?.transport === 'stdio'
    ? [server.config.command, ...(server.config.args ?? [])].join(' ')
    : server.config?.url;

  return (
    <div className="v2-settings-row">
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <p className="v2-type-body-strong min-w-0 truncate text-foreground">{server.id}</p>
          <McpStatusPill label={t(statusLabelKeys[server.status])} status={server.status} />
          {server.config?.transport ? <McpSourcePill label={server.config.transport} /> : null}
          <McpSourcePill label={`${server.toolCount.toLocaleString()} ${t('mcpSettings.toolsLabel')}`} />
        </div>
        {target ? <p className="v2-type-panel-subtitle mt-1 truncate font-mono text-muted-foreground">{target}</p> : null}
        {server.catalog?.refreshedAt ? (
          <p className="v2-type-caption mt-2 truncate text-muted-foreground">
            {t('mcpSettings.refreshedAt')}: {server.catalog.refreshedAt}
          </p>
        ) : null}
      </div>
      <div className="flex min-w-0 items-center justify-end gap-3">
        <Button
          disabled={!enabled || updating || refreshing}
          size="sm"
          type="button"
          variant="outline"
          onClick={() => void onRefreshServer(server.id)}
        >
          {refreshing ? t('mcpSettings.refreshing') : t('mcpSettings.refreshAction')}
        </Button>
        <span className="v2-type-caption text-muted-foreground">{pending ? t('mcpSettings.updating') : label}</span>
        <Switch
          aria-label={`${label}: ${server.id}`}
          checked={enabled}
          disabled={updating || pending || missing}
          onCheckedChange={(checked) => void onSetServerEnabled(server.id, checked)}
        />
      </div>
    </div>
  );
}

function McpMetricPill({ detail, label, value }: { detail: string; label: string; value: number }) {
  return (
    <div className="inline-flex min-w-0 items-center gap-2 rounded-md border border-border bg-muted/15 px-2.5 py-1" title={detail}>
      <dt className="v2-type-caption min-w-0 truncate text-muted-foreground">{label}</dt>
      <dd className="v2-type-caption tabular-nums text-foreground">
        {value.toLocaleString()}
        <span className="sr-only">, {detail}</span>
      </dd>
    </div>
  );
}

function McpStatusPill({ label, status }: { label: string; status: McpServerStatus }) {
  return (
    <span className={cn('v2-type-caption shrink-0 rounded-sm border px-1.5 py-0.5 tabular-nums', statusToneClasses[status])}>
      {label}
    </span>
  );
}

function McpSourcePill({ label }: { label: string }) {
  return (
    <span className="v2-type-caption shrink-0 rounded-sm border border-border bg-muted/20 px-1.5 py-0.5 text-muted-foreground">
      {label}
    </span>
  );
}

function McpSettingsAlert({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-destructive/45 bg-destructive/10 px-3 py-2">
      <p className="v2-type-caption text-pretty text-destructive">{message}</p>
    </div>
  );
}

function McpSettingsEmpty({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex h-full min-h-0 items-center justify-center px-6">
      <div className="max-w-sm text-center">
        <p className="v2-type-body-strong text-foreground">{title}</p>
        <p className="v2-type-panel-subtitle mt-1 text-pretty text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}
