import { useMemo, useState } from 'react';
import { Copy, Pencil, Trash2 } from 'lucide-react';
import type { ControlPlaneCustomAgent, ControlPlaneCustomAgents } from '@web/api/client';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@web/components/ui/alert-dialog';
import { Button } from '@web/components/ui/button';
import { Input } from '@web/components/ui/input';
import type { I18nMessageKey } from '@web/i18n';
import { useI18n } from '@web/i18n';
import { cn } from '@web/lib/utils';

export interface AgentsSettingsViewProps {
  agents?: ControlPlaneCustomAgents;
  loading: boolean;
  error?: string;
  deleting: boolean;
  onDeleteProjectAgent: (agentProfileId: string) => Promise<void>;
}

const modeLabelKeys = {
  ask: 'agentSettings.mode.ask',
  code: 'agentSettings.mode.code',
  review: 'agentSettings.mode.review',
} satisfies Record<NonNullable<ControlPlaneCustomAgent['modeAlias']>, I18nMessageKey>;

const sourceLabelKeys = {
  'built-in': 'agentSettings.source.builtIn',
  project: 'agentSettings.source.project',
  user: 'agentSettings.source.user',
} satisfies Record<ControlPlaneCustomAgent['source'], I18nMessageKey>;

const sourceToneClasses = {
  'built-in': 'border-primary/45 bg-primary/10 text-foreground',
  project: 'border-emerald-400/30 bg-emerald-400/10 text-foreground',
  user: 'border-border bg-muted/20 text-muted-foreground',
} satisfies Record<ControlPlaneCustomAgent['source'], string>;

export function AgentsSettingsView({
  agents,
  deleting,
  error,
  loading,
  onDeleteProjectAgent,
}: AgentsSettingsViewProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [pendingAgentId, setPendingAgentId] = useState<string | undefined>();
  const [copiedAgentId, setCopiedAgentId] = useState<string | undefined>();
  const [actionError, setActionError] = useState<string | undefined>();
  const allAgents = useMemo(() => agents?.agents ?? [], [agents?.agents]);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleAgents = useMemo(() => {
    if (!normalizedQuery) {
      return allAgents;
    }

    return allAgents.filter((agent) => [
      agent.id,
      agent.name,
      agent.description,
      agent.modeAlias,
      agent.source,
      agent.definitionPath,
    ].some((value) => value?.toLocaleLowerCase().includes(normalizedQuery)));
  }, [allAgents, normalizedQuery]);
  const counts = useMemo(() => allAgents.reduce<Record<ControlPlaneCustomAgent['source'], number>>((current, agent) => ({
    ...current,
    [agent.source]: current[agent.source] + 1,
  }), {
    'built-in': 0,
    project: 0,
    user: 0,
  }), [allAgents]);

  async function deleteProjectAgent(agentProfileId: string) {
    try {
      setActionError(undefined);
      setPendingAgentId(agentProfileId);
      await onDeleteProjectAgent(agentProfileId);
    } catch (nextError) {
      setActionError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setPendingAgentId(undefined);
    }
  }

  async function copyAgentId(agentProfileId: string) {
    try {
      await navigator.clipboard.writeText(agentProfileId);
      setCopiedAgentId(agentProfileId);
    } catch (nextError) {
      setActionError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  }

  if (loading && !agents) {
    return <AgentsSettingsEmpty title={t('agentSettings.loadingTitle')} body={t('agentSettings.loadingBody')} />;
  }

  if (error && !agents) {
    return <AgentsSettingsEmpty title={t('agentSettings.errorTitle')} body={error} />;
  }

  return (
    <div className="v2-scrollbar-hidden h-full min-w-0 overflow-auto">
      <div className="v2-settings-page mx-auto flex w-full max-w-5xl flex-col gap-6 px-8 py-8">
        <section className="min-w-0">
          <div className="mb-3 flex min-w-0 flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <h2 className="v2-type-section-label text-muted-foreground">{t('agentSettings.overviewTitle')}</h2>
              <p className="v2-type-panel-subtitle mt-1 max-w-2xl text-pretty text-muted-foreground">
                {t('agentSettings.overviewBody')}
              </p>
            </div>
            <Input
              aria-label={t('agentSettings.searchLabel')}
              className="v2-control w-full sm:w-72"
              placeholder={t('agentSettings.searchPlaceholder')}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <dl className="flex min-w-0 flex-wrap items-center gap-2">
            <AgentMetricPill label={t('agentSettings.metrics.builtIn')} value={counts['built-in']} />
            <AgentMetricPill label={t('agentSettings.metrics.project')} value={counts.project} />
            <AgentMetricPill label={t('agentSettings.metrics.user')} value={counts.user} />
            <AgentMetricPill label={t('agentSettings.metrics.issues')} value={agents?.issues.length ?? 0} />
          </dl>
        </section>

        {actionError ? <AgentsSettingsAlert message={actionError} /> : null}

        <section className="min-w-0">
          <h2 className="v2-type-section-label mb-3 text-muted-foreground">{t('agentSettings.catalogTitle')}</h2>
          {visibleAgents.length ? (
            <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
              {visibleAgents.map((agent) => (
                <AgentTile
                  agent={agent}
                  copied={copiedAgentId === agent.id}
                  deleting={deleting}
                  key={agent.id}
                  pending={pendingAgentId === agent.id}
                  onCopyAgentId={copyAgentId}
                  onDeleteProjectAgent={deleteProjectAgent}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-md border border-border bg-card px-4 py-5">
              <p className="v2-type-caption text-muted-foreground">{t('agentSettings.emptyCatalog')}</p>
            </div>
          )}
        </section>

        {agents?.issues.length ? (
          <section className="min-w-0">
            <h2 className="v2-type-section-label mb-3 text-muted-foreground">{t('agentSettings.issuesTitle')}</h2>
            <div className="v2-settings-group">
              {agents.issues.map((issue) => (
                <div className="v2-settings-row" key={`${issue.source}:${issue.path ?? 'unknown'}:${issue.message}`}>
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <AgentSourcePill label={t(sourceLabelKeys[issue.source])} source={issue.source} />
                      <p className="v2-type-nav-primary min-w-0 truncate text-foreground">{issue.path ?? t('agentSettings.unknownPath')}</p>
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

function AgentTile({
  agent,
  copied,
  deleting,
  pending,
  onCopyAgentId,
  onDeleteProjectAgent,
}: {
  agent: ControlPlaneCustomAgent;
  copied: boolean;
  deleting: boolean;
  pending: boolean;
  onCopyAgentId: (agentProfileId: string) => Promise<void>;
  onDeleteProjectAgent: (agentProfileId: string) => Promise<void>;
}) {
  const { t } = useI18n();
  const deletable = agent.source === 'project';
  const deleteDisabled = deleting || pending || !deletable;
  const deleteTitle = deletable ? t('agentSettings.deleteAction') : t('agentSettings.deleteUnavailable');

  return (
    <article className="flex min-h-64 min-w-0 flex-col justify-between rounded-md border border-border bg-card p-4 text-card-foreground shadow-sm">
      <div className="min-w-0">
        <div className="mb-3 flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="v2-type-panel-title truncate text-foreground">{agent.name}</h3>
            <p className="v2-type-caption mt-1 truncate font-mono text-muted-foreground">{agent.id}</p>
          </div>
          <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
            <AgentSourcePill label={t(sourceLabelKeys[agent.source])} source={agent.source} />
            {agent.modeAlias ? <AgentModePill label={t(modeLabelKeys[agent.modeAlias])} /> : null}
          </div>
        </div>
        <p className="v2-type-panel-subtitle line-clamp-3 text-pretty text-muted-foreground">{agent.description}</p>

        <dl className="mt-4 grid min-w-0 grid-cols-2 gap-3">
          <AgentFact label={t('agentSettings.toolProfileLabel')} value={agent.tools.preset} />
          <AgentFact label={t('agentSettings.approvalProfileLabel')} value={agent.approval.preset} />
          <AgentFact label={t('agentSettings.maxStepsLabel')} value={agent.runtime.maxSteps?.toLocaleString() ?? t('agentSettings.inheritValue')} />
          <AgentFact label={t('agentSettings.modelLabel')} value={agent.runtime.model ?? t('agentSettings.inheritValue')} />
        </dl>

        {agent.definitionPath ? (
          <p className="v2-type-caption mt-4 truncate font-mono text-muted-foreground">{agent.definitionPath}</p>
        ) : null}
      </div>

      <div className="mt-4 flex min-w-0 flex-wrap items-center gap-2">
        <Button
          aria-label={`${copied ? t('agentSettings.copiedAction') : t('agentSettings.copyIdAction')}: ${agent.name}`}
          size="sm"
          type="button"
          variant="outline"
          onClick={() => void onCopyAgentId(agent.id)}
        >
          <Copy aria-hidden="true" />
          {copied ? t('agentSettings.copiedAction') : t('agentSettings.copyIdAction')}
        </Button>
        <Button
          aria-label={`${t('agentSettings.editAction')}: ${agent.name}`}
          disabled
          size="sm"
          title={t('agentSettings.editUnavailable')}
          type="button"
          variant="outline"
        >
          <Pencil aria-hidden="true" />
          {t('agentSettings.editAction')}
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              aria-label={`${t('agentSettings.deleteAction')}: ${agent.name}`}
              disabled={deleteDisabled}
              size="sm"
              title={deleteTitle}
              type="button"
              variant={deletable ? 'destructive' : 'outline'}
            >
              <Trash2 aria-hidden="true" />
              {pending ? t('agentSettings.deleting') : t('agentSettings.deleteAction')}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('agentSettings.deleteDialogTitle')}</AlertDialogTitle>
              <AlertDialogDescription>
                {t('agentSettings.deleteDialogBody')}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="rounded-md border border-border bg-muted/20 px-3 py-2">
              <p className="v2-type-body-strong truncate text-foreground">{agent.name}</p>
              <p className="v2-type-caption mt-1 truncate font-mono text-muted-foreground">{agent.definitionPath}</p>
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleting}>{t('agentSettings.cancelAction')}</AlertDialogCancel>
              <AlertDialogAction
                disabled={deleting}
                onClick={() => void onDeleteProjectAgent(agent.id)}
              >
                {t('agentSettings.deleteConfirmAction')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </article>
  );
}

function AgentFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md border border-border bg-muted/15 px-2.5 py-2">
      <dt className="v2-type-caption truncate text-muted-foreground">{label}</dt>
      <dd className="v2-type-caption mt-1 truncate text-foreground">{value}</dd>
    </div>
  );
}

function AgentMetricPill({ label, value }: { label: string; value: number }) {
  return (
    <div className="inline-flex min-w-0 items-center gap-2 rounded-md border border-border bg-muted/15 px-2.5 py-1">
      <dt className="v2-type-caption min-w-0 truncate text-muted-foreground">{label}</dt>
      <dd className="v2-type-caption tabular-nums text-foreground">{value.toLocaleString()}</dd>
    </div>
  );
}

function AgentSourcePill({ label, source }: { label: string; source: ControlPlaneCustomAgent['source'] }) {
  return (
    <span className={cn('v2-type-caption shrink-0 rounded-sm border px-1.5 py-0.5 tabular-nums', sourceToneClasses[source])}>
      {label}
    </span>
  );
}

function AgentModePill({ label }: { label: string }) {
  return (
    <span className="v2-type-caption shrink-0 rounded-sm border border-border bg-muted/20 px-1.5 py-0.5 text-muted-foreground">
      {label}
    </span>
  );
}

function AgentsSettingsAlert({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-destructive/45 bg-destructive/10 px-3 py-2">
      <p className="v2-type-caption text-pretty text-destructive">{message}</p>
    </div>
  );
}

function AgentsSettingsEmpty({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex h-full min-h-0 items-center justify-center px-6">
      <div className="max-w-sm text-center">
        <p className="v2-type-body-strong text-foreground">{title}</p>
        <p className="v2-type-panel-subtitle mt-1 text-pretty text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}
