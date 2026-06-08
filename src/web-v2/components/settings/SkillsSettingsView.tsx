import { useMemo, useState } from 'react';
import type { ControlPlaneSkillActivationView, ControlPlaneSkills } from '@web/api/client';
import { Input } from '@web/components/ui/input';
import { Switch } from '@web/components/ui/switch';
import type { I18nMessageKey } from '@web/i18n';
import { useI18n } from '@web/i18n';
import { cn } from '@web/lib/utils';

export interface SkillsSettingsViewProps {
  skills?: ControlPlaneSkills;
  loading: boolean;
  error?: string;
  updating: boolean;
  onSetSkillActive: (name: string, active: boolean) => Promise<void>;
}

type SkillStatus = ControlPlaneSkillActivationView['status'];

const skillStatusSections = [
  { status: 'active', labelKey: 'skillSettings.sections.active', detailKey: 'skillSettings.sectionDetails.active' },
  { status: 'available', labelKey: 'skillSettings.sections.available', detailKey: 'skillSettings.sectionDetails.available' },
  { status: 'disabled', labelKey: 'skillSettings.sections.disabled', detailKey: 'skillSettings.sectionDetails.disabled' },
  { status: 'missing', labelKey: 'skillSettings.sections.missing', detailKey: 'skillSettings.sectionDetails.missing' },
] satisfies { status: SkillStatus; labelKey: I18nMessageKey; detailKey: I18nMessageKey }[];

const statusLabelKeys = {
  active: 'skillSettings.status.active',
  available: 'skillSettings.status.available',
  disabled: 'skillSettings.status.disabled',
  missing: 'skillSettings.status.missing',
} satisfies Record<SkillStatus, I18nMessageKey>;

const sourceLabelKeys = {
  'built-in': 'skillSettings.source.builtIn',
  project: 'skillSettings.source.project',
  user: 'skillSettings.source.user',
} satisfies Record<NonNullable<ControlPlaneSkillActivationView['catalogEntry']>['source'], I18nMessageKey>;

const statusToneClasses = {
  active: 'border-primary/45 bg-primary/10 text-foreground',
  available: 'border-border bg-muted/20 text-muted-foreground',
  disabled: 'border-warning/45 bg-warning/10 text-foreground',
  missing: 'border-destructive/45 bg-destructive/10 text-destructive',
} satisfies Record<SkillStatus, string>;

export function SkillsSettingsView({
  skills,
  loading,
  error,
  updating,
  onSetSkillActive,
}: SkillsSettingsViewProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [pendingSkillName, setPendingSkillName] = useState<string | undefined>();
  const [actionError, setActionError] = useState<string | undefined>();
  const allSkills = useMemo(() => skills?.skills ?? [], [skills?.skills]);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleSkills = useMemo(() => {
    if (!normalizedQuery) {
      return allSkills;
    }

    return allSkills.filter((skill) => [
      skill.name,
      skill.catalogEntry?.description,
      skill.catalogEntry?.source ?? skill.record?.source,
      skill.catalogEntry?.skillFilePath ?? skill.record?.skillFilePath,
    ].some((value) => value?.toLocaleLowerCase().includes(normalizedQuery)));
  }, [allSkills, normalizedQuery]);
  const counts = useMemo(() => skillStatusSections.reduce<Record<SkillStatus, number>>((current, section) => ({
    ...current,
    [section.status]: allSkills.filter((skill) => skill.status === section.status).length,
  }), {
    active: 0,
    available: 0,
    disabled: 0,
    missing: 0,
  }), [allSkills]);

  async function setSkillActive(name: string, active: boolean) {
    try {
      setActionError(undefined);
      setPendingSkillName(name);
      await onSetSkillActive(name, active);
    } catch (nextError) {
      setActionError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setPendingSkillName(undefined);
    }
  }

  if (loading && !skills) {
    return <SkillsSettingsEmpty title={t('skillSettings.loadingTitle')} body={t('skillSettings.loadingBody')} />;
  }

  if (error && !skills) {
    return <SkillsSettingsEmpty title={t('skillSettings.errorTitle')} body={error} />;
  }

  return (
    <div className="v2-scrollbar-hidden h-full min-w-0 overflow-auto">
      <div className="v2-settings-page mx-auto flex w-full max-w-4xl flex-col gap-6 px-8 py-8">
        <section className="min-w-0">
          <div className="mb-3 flex min-w-0 flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <h2 className="v2-type-section-label text-muted-foreground">{t('skillSettings.overviewTitle')}</h2>
              <p className="v2-type-panel-subtitle mt-1 text-pretty text-muted-foreground">
                {skills?.activationStorePath ?? t('skillSettings.noActivationStore')}
              </p>
            </div>
            <Input
              aria-label={t('skillSettings.searchLabel')}
              className="v2-control w-full sm:w-64"
              placeholder={t('skillSettings.searchPlaceholder')}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <dl className="flex min-w-0 flex-wrap items-center gap-2">
            <SkillMetricPill
              label={t('skillSettings.metrics.active')}
              value={counts.active}
              detail={t('skillSettings.metrics.activeDetail')}
            />
            <SkillMetricPill
              label={t('skillSettings.metrics.available')}
              value={counts.available}
              detail={t('skillSettings.metrics.availableDetail')}
            />
            <SkillMetricPill
              label={t('skillSettings.metrics.disabled')}
              value={counts.disabled + counts.missing}
              detail={t('skillSettings.metrics.disabledDetail')}
            />
          </dl>
        </section>

        {actionError ? <SkillsSettingsAlert message={actionError} /> : null}

        <section className="min-w-0">
          <h2 className="v2-type-section-label mb-3 text-muted-foreground">{t('skillSettings.catalogTitle')}</h2>
          <div className="flex flex-col gap-4">
            {skillStatusSections.map((section) => (
              <SkillSection
                key={section.status}
                detail={t(section.detailKey)}
                label={t(section.labelKey)}
                pendingSkillName={pendingSkillName}
                skills={visibleSkills.filter((skill) => skill.status === section.status)}
                updating={updating}
                onSetSkillActive={setSkillActive}
              />
            ))}
          </div>
        </section>

        {skills?.issues.length ? (
          <section className="min-w-0">
            <h2 className="v2-type-section-label mb-3 text-muted-foreground">{t('skillSettings.issuesTitle')}</h2>
            <div className="v2-settings-group">
              {skills.issues.map((issue) => (
                <div className="v2-settings-row" key={`${issue.code}:${issue.path}`}>
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <SkillStatusPill label={issue.code} status="missing" />
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

function SkillSection({
  detail,
  label,
  pendingSkillName,
  skills,
  updating,
  onSetSkillActive,
}: {
  detail: string;
  label: string;
  pendingSkillName?: string;
  skills: ControlPlaneSkillActivationView[];
  updating: boolean;
  onSetSkillActive: (name: string, active: boolean) => Promise<void>;
}) {
  const { t } = useI18n();
  return (
    <div className="min-w-0">
      <div className="mb-2 flex min-w-0 items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="v2-type-nav-primary text-foreground">{label}</h3>
          <p className="v2-type-caption mt-0.5 truncate text-muted-foreground">{detail}</p>
        </div>
        <span className="v2-type-caption tabular-nums text-muted-foreground">{skills.length}</span>
      </div>
      <div className="v2-settings-group">
        {skills.length ? skills.map((skill) => (
          <SkillRow
            key={skill.name}
            pending={pendingSkillName === skill.name}
            skill={skill}
            updating={updating}
            onSetSkillActive={onSetSkillActive}
          />
        )) : (
          <div className="v2-settings-row">
            <p className="v2-type-caption text-muted-foreground">{t('skillSettings.emptySection')}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function SkillRow({
  pending,
  skill,
  updating,
  onSetSkillActive,
}: {
  pending: boolean;
  skill: ControlPlaneSkillActivationView;
  updating: boolean;
  onSetSkillActive: (name: string, active: boolean) => Promise<void>;
}) {
  const { t } = useI18n();
  const source = skill.catalogEntry?.source ?? skill.record?.source;
  const path = skill.catalogEntry?.skillFilePath ?? skill.record?.skillFilePath;
  const enabled = skill.status === 'active';
  const unavailable = skill.status === 'missing';
  const description = skill.catalogEntry?.description ?? t('skillSettings.missingDescription');
  const label = enabled ? t('skillSettings.disableAction') : t('skillSettings.enableAction');

  return (
    <div className="v2-settings-row">
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <p className="v2-type-body-strong min-w-0 truncate text-foreground">{skill.name}</p>
          <SkillStatusPill label={t(statusLabelKeys[skill.status])} status={skill.status} />
          {source ? <SkillSourcePill label={t(sourceLabelKeys[source])} /> : null}
        </div>
        <p className="v2-type-panel-subtitle mt-1 line-clamp-2 text-pretty text-muted-foreground">{description}</p>
        {path ? <p className="v2-type-caption mt-2 truncate font-mono text-muted-foreground">{path}</p> : null}
      </div>
      <div className="flex min-w-0 items-center justify-end gap-3">
        <span className="v2-type-caption text-muted-foreground">{pending ? t('skillSettings.updating') : label}</span>
        <Switch
          aria-label={`${label}: ${skill.name}`}
          checked={enabled}
          disabled={updating || pending || unavailable}
          onCheckedChange={(checked) => void onSetSkillActive(skill.name, checked)}
        />
      </div>
    </div>
  );
}

function SkillMetricPill({
  detail,
  label,
  value,
}: {
  detail: string;
  label: string;
  value: number;
}) {
  return (
    <div
      className="inline-flex min-w-0 items-center gap-2 rounded-md border border-border bg-muted/15 px-2.5 py-1"
      title={detail}
    >
      <dt className="v2-type-caption min-w-0 truncate text-muted-foreground">{label}</dt>
      <dd className="v2-type-caption tabular-nums text-foreground">
        {value.toLocaleString()}
        <span className="sr-only">, {detail}</span>
      </dd>
    </div>
  );
}

function SkillStatusPill({ label, status }: { label: string; status: SkillStatus }) {
  return (
    <span className={cn('v2-type-caption shrink-0 rounded-sm border px-1.5 py-0.5 tabular-nums', statusToneClasses[status])}>
      {label}
    </span>
  );
}

function SkillSourcePill({ label }: { label: string }) {
  return (
    <span className="v2-type-caption shrink-0 rounded-sm border border-border bg-muted/20 px-1.5 py-0.5 text-muted-foreground">
      {label}
    </span>
  );
}

function SkillsSettingsAlert({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-destructive/45 bg-destructive/10 px-3 py-2">
      <p className="v2-type-caption text-pretty text-destructive">{message}</p>
    </div>
  );
}

function SkillsSettingsEmpty({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex h-full min-h-0 items-center justify-center px-6">
      <div className="max-w-sm text-center">
        <p className="v2-type-body-strong text-foreground">{title}</p>
        <p className="v2-type-panel-subtitle mt-1 text-pretty text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}
