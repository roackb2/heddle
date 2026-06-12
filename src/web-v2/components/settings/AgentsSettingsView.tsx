import type { FormEvent, ReactNode } from 'react';
import { useId, useMemo, useState } from 'react';
import { Copy, Pencil, Plus, Trash2 } from 'lucide-react';
import type { ControlPlaneCustomAgent, ControlPlaneCustomAgentCreateInput, ControlPlaneCustomAgents } from '@web/api/client';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@web/components/ui/dialog';
import { Input } from '@web/components/ui/input';
import { Textarea } from '@web/components/ui/textarea';
import type { I18nMessageKey } from '@web/i18n';
import { useI18n } from '@web/i18n';
import { cn } from '@web/lib/utils';

type ProjectAgentCreateInput = Omit<ControlPlaneCustomAgentCreateInput, 'workspaceId'>;

export interface AgentsSettingsViewProps {
  agents?: ControlPlaneCustomAgents;
  loading: boolean;
  error?: string;
  creating: boolean;
  deleting: boolean;
  onCreateProjectAgent: (input: ProjectAgentCreateInput) => Promise<void>;
  onDeleteProjectAgent: (agentProfileId: string) => Promise<void>;
}

type AgentCreateDraft = {
  id: string;
  name: string;
  description: string;
  access: 'read_only' | 'write';
  changeApproval: Extract<ProjectAgentCreateInput['approvalPreset'], 'interactive' | 'auto'>;
  maxSteps: string;
  promptAppendix: string;
};

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

const defaultCreateDraft: AgentCreateDraft = {
  id: '',
  name: '',
  description: '',
  access: 'read_only',
  changeApproval: 'interactive',
  maxSteps: '80',
  promptAppendix: '',
};

const accessOptions = ['read_only', 'write'] satisfies AgentCreateDraft['access'][];
const changeApprovalOptions = ['interactive', 'auto'] satisfies AgentCreateDraft['changeApproval'][];

export function AgentsSettingsView({
  agents,
  creating,
  deleting,
  error,
  loading,
  onCreateProjectAgent,
  onDeleteProjectAgent,
}: AgentsSettingsViewProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [pendingAgentId, setPendingAgentId] = useState<string | undefined>();
  const [copiedAgentId, setCopiedAgentId] = useState<string | undefined>();
  const [actionError, setActionError] = useState<string | undefined>();
  const [createOpen, setCreateOpen] = useState(false);
  const [createDraft, setCreateDraft] = useState<AgentCreateDraft>(defaultCreateDraft);
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

  async function createProjectAgent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const maxStepsText = createDraft.maxSteps.trim();
    const maxSteps = maxStepsText ? Number(maxStepsText) : undefined;
    if (maxSteps !== undefined && (!Number.isInteger(maxSteps) || maxSteps <= 0)) {
      setActionError(t('agentSettings.maxStepsInvalid'));
      return;
    }

    try {
      setActionError(undefined);
      await onCreateProjectAgent({
        id: createDraft.id.trim(),
        name: createDraft.name.trim(),
        description: createDraft.description.trim(),
        toolsPreset: createDraft.access === 'read_only' ? 'inspect' : 'default',
        approvalPreset: createDraft.access === 'read_only' ? 'read_only' : createDraft.changeApproval,
        maxSteps,
        promptAppendix: createDraft.promptAppendix.trim(),
      });
      setCreateDraft(defaultCreateDraft);
      setCreateOpen(false);
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
            <div className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto">
              <CreateAgentDialog
                creating={creating}
                draft={createDraft}
                open={createOpen}
                onDraftChange={setCreateDraft}
                onOpenChange={setCreateOpen}
                onSubmit={createProjectAgent}
              />
              <Input
                aria-label={t('agentSettings.searchLabel')}
                className="v2-control w-full sm:w-72"
                placeholder={t('agentSettings.searchPlaceholder')}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
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

function CreateAgentDialog({
  creating,
  draft,
  open,
  onDraftChange,
  onOpenChange,
  onSubmit,
}: {
  creating: boolean;
  draft: AgentCreateDraft;
  open: boolean;
  onDraftChange: (draft: AgentCreateDraft) => void;
  onOpenChange: (open: boolean) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
}) {
  const { t } = useI18n();
  const updateDraft = <Key extends keyof AgentCreateDraft>(key: Key, value: AgentCreateDraft[Key]) => {
    onDraftChange({ ...draft, [key]: value });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" className="shrink-0">
          <Plus aria-hidden="true" />
          {t('agentSettings.createAction')}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <form className="grid gap-4" onSubmit={(event) => void onSubmit(event)}>
          <DialogHeader>
            <DialogTitle>{t('agentSettings.createDialogTitle')}</DialogTitle>
            <DialogDescription>{t('agentSettings.createDialogBody')}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-2">
            <AgentFormField label={t('agentSettings.idLabel')}>
              <Input
                required
                className="v2-control"
                placeholder={t('agentSettings.idPlaceholder')}
                value={draft.id}
                onChange={(event) => updateDraft('id', event.target.value)}
              />
            </AgentFormField>
            <AgentFormField label={t('agentSettings.nameLabel')}>
              <Input
                required
                className="v2-control"
                placeholder={t('agentSettings.namePlaceholder')}
                value={draft.name}
                onChange={(event) => updateDraft('name', event.target.value)}
              />
            </AgentFormField>
          </div>

          <AgentFormField label={t('agentSettings.descriptionLabel')}>
            <Input
              required
              className="v2-control"
              placeholder={t('agentSettings.descriptionPlaceholder')}
              value={draft.description}
              onChange={(event) => updateDraft('description', event.target.value)}
            />
          </AgentFormField>

          <AgentFormField label={t('agentSettings.promptLabel')}>
            <Textarea
              required
              className="v2-control min-h-32 px-3 py-2"
              placeholder={t('agentSettings.promptPlaceholder')}
              value={draft.promptAppendix}
              onChange={(event) => updateDraft('promptAppendix', event.target.value)}
            />
          </AgentFormField>

          <div className="grid gap-3 sm:grid-cols-2">
            <AgentChoiceGroup
              label={t('agentSettings.accessLabel')}
              options={accessOptions.map((access) => ({
                id: access,
                title: t(access === 'read_only' ? 'agentSettings.access.readOnly.label' : 'agentSettings.access.write.label'),
                description: t(access === 'read_only' ? 'agentSettings.access.readOnly.description' : 'agentSettings.access.write.description'),
              }))}
              value={draft.access}
              onValueChange={(value) => updateDraft('access', value as AgentCreateDraft['access'])}
            />
            {draft.access === 'write' ? (
              <AgentChoiceGroup
                label={t('agentSettings.changeApprovalLabel')}
                options={changeApprovalOptions.map((approval) => ({
                  id: approval,
                  title: t(approval === 'interactive' ? 'agentSettings.changeApproval.interactive.label' : 'agentSettings.changeApproval.auto.label'),
                  description: t(approval === 'interactive' ? 'agentSettings.changeApproval.interactive.description' : 'agentSettings.changeApproval.auto.description'),
                }))}
                value={draft.changeApproval}
                onValueChange={(value) => updateDraft('changeApproval', value as AgentCreateDraft['changeApproval'])}
              />
            ) : (
              <div className="rounded-md border border-border bg-muted/10 px-3 py-2">
                <p className="v2-type-caption text-muted-foreground">{t('agentSettings.readOnlyApprovalNote')}</p>
              </div>
            )}
          </div>

          <AgentFormField label={t('agentSettings.maxStepsLabel')}>
            <Input
              className="v2-control"
              inputMode="numeric"
              placeholder={t('agentSettings.maxStepsPlaceholder')}
              value={draft.maxSteps}
              onChange={(event) => updateDraft('maxSteps', event.target.value)}
            />
          </AgentFormField>

          <DialogFooter>
            <Button type="button" variant="outline" disabled={creating} onClick={() => onOpenChange(false)}>
              {t('agentSettings.cancelAction')}
            </Button>
            <Button type="submit" disabled={creating}>
              {creating ? t('agentSettings.creating') : t('agentSettings.createConfirmAction')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AgentChoiceGroup<Value extends string>({
  label,
  onValueChange,
  options,
  value,
}: {
  label: string;
  options: Array<{ id: Value; title: string; description: string }>;
  value: Value;
  onValueChange: (value: Value) => void;
}) {
  const radioGroupName = useId();

  return (
    <fieldset className="grid min-w-0 gap-1.5">
      <legend className="v2-type-caption text-muted-foreground">{label}</legend>
      <div className="grid gap-2">
        {options.map((option) => (
          <label
            className={cn(
              'grid cursor-pointer gap-1 rounded-md border px-3 py-2',
              option.id === value ? 'border-primary/55 bg-primary/10' : 'border-border bg-muted/10',
            )}
            key={option.id}
          >
            <input
              checked={option.id === value}
              className="sr-only"
              name={radioGroupName}
              type="radio"
              value={option.id}
              onChange={() => onValueChange(option.id)}
            />
            <span className="v2-type-body-strong text-foreground">{option.title}</span>
            <span className="v2-type-caption text-pretty text-muted-foreground">{option.description}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function AgentFormField({ children, label }: { children: ReactNode; label: string }) {
  return (
    <label className="grid min-w-0 gap-1.5">
      <span className="v2-type-caption text-muted-foreground">{label}</span>
      {children}
    </label>
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
