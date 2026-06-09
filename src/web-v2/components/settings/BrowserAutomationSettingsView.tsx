import { useState } from 'react';
import type { ControlPlaneBrowserAutomation } from '@web/api/client';
import { Switch } from '@web/components/ui/switch';
import { useI18n } from '@web/i18n';
import { cn } from '@web/lib/utils';

export interface BrowserAutomationSettingsViewProps {
  browserAutomation?: ControlPlaneBrowserAutomation;
  loading: boolean;
  error?: string;
  updating: boolean;
  onSetEnabled: (enabled: boolean) => Promise<void>;
}

export function BrowserAutomationSettingsView({
  browserAutomation,
  loading,
  error,
  updating,
  onSetEnabled,
}: BrowserAutomationSettingsViewProps) {
  const { t } = useI18n();
  const [actionError, setActionError] = useState<string | undefined>();

  async function setEnabled(enabled: boolean) {
    try {
      setActionError(undefined);
      await onSetEnabled(enabled);
    } catch (nextError) {
      setActionError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  }

  if (loading && !browserAutomation) {
    return <BrowserAutomationEmpty title={t('browserAutomationSettings.loadingTitle')} body={t('browserAutomationSettings.loadingBody')} />;
  }

  if (error && !browserAutomation) {
    return <BrowserAutomationEmpty title={t('browserAutomationSettings.errorTitle')} body={error} />;
  }

  const enabled = browserAutomation?.enabled ?? false;
  const skillStatus = browserAutomation?.skill?.status ?? 'missing';

  return (
    <div className="v2-scrollbar-hidden h-full min-w-0 overflow-auto">
      <div className="v2-settings-page mx-auto flex w-full max-w-4xl flex-col gap-6 px-8 py-8">
        <section className="min-w-0">
          <div className="mb-3 flex min-w-0 flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <h2 className="v2-type-section-label text-muted-foreground">{t('browserAutomationSettings.overviewTitle')}</h2>
              <p className="v2-type-panel-subtitle mt-1 text-pretty text-muted-foreground">
                {browserAutomation?.activationStorePath ?? t('browserAutomationSettings.noActivationStore')}
              </p>
            </div>
            <BrowserAutomationStatusPill enabled={enabled} />
          </div>

          <div className="v2-settings-group">
            <div className="v2-settings-row">
              <div className="min-w-0">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <p className="v2-type-body-strong min-w-0 truncate text-foreground">{t('browserAutomationSettings.switchTitle')}</p>
                  <span className="v2-type-caption shrink-0 rounded-sm border border-border bg-muted/20 px-1.5 py-0.5 text-muted-foreground">
                    {browserAutomation?.skillName ?? 'browser-automation'}
                  </span>
                </div>
                <p className="v2-type-panel-subtitle mt-1 max-w-2xl text-pretty text-muted-foreground">
                  {t('browserAutomationSettings.switchDetail')}
                </p>
              </div>
              <div className="flex min-w-0 items-center justify-end gap-3">
                <span className="v2-type-caption text-muted-foreground">
                  {updating ? t('browserAutomationSettings.updating') : enabled ? t('browserAutomationSettings.disableAction') : t('browserAutomationSettings.enableAction')}
                </span>
                <Switch
                  aria-label={enabled ? t('browserAutomationSettings.disableAction') : t('browserAutomationSettings.enableAction')}
                  checked={enabled}
                  disabled={updating || skillStatus === 'missing'}
                  onCheckedChange={(checked) => void setEnabled(checked)}
                />
              </div>
            </div>
          </div>
        </section>

        {actionError ? <BrowserAutomationAlert message={actionError} /> : null}

        <section className="min-w-0">
          <h2 className="v2-type-section-label mb-3 text-muted-foreground">{t('browserAutomationSettings.detailsTitle')}</h2>
          <div className="v2-settings-group">
            <BrowserAutomationDetailRow
              label={t('browserAutomationSettings.skillStatusLabel')}
              value={skillStatus}
            />
            <BrowserAutomationDetailRow
              label={t('browserAutomationSettings.profileLabel')}
              value={browserAutomation?.profileRequirement ?? t('browserAutomationSettings.profileFallback')}
            />
            <BrowserAutomationDetailRow
              label={t('browserAutomationSettings.toolsLabel')}
              value={browserAutomation?.toolAvailability ?? t('browserAutomationSettings.toolsFallback')}
            />
          </div>
        </section>
      </div>
    </div>
  );
}

function BrowserAutomationStatusPill({ enabled }: { enabled: boolean }) {
  const { t } = useI18n();
  return (
    <span
      className={cn(
        'v2-type-caption shrink-0 rounded-md border px-2.5 py-1 tabular-nums',
        enabled
          ? 'border-primary/45 bg-primary/10 text-foreground'
          : 'border-border bg-muted/20 text-muted-foreground',
      )}
    >
      {enabled ? t('browserAutomationSettings.enabled') : t('browserAutomationSettings.disabled')}
    </span>
  );
}

function BrowserAutomationDetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="v2-settings-row">
      <div className="min-w-0">
        <p className="v2-type-caption text-muted-foreground">{label}</p>
        <p className="v2-type-panel-subtitle mt-1 text-pretty text-foreground">{value}</p>
      </div>
    </div>
  );
}

function BrowserAutomationAlert({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-destructive/45 bg-destructive/10 px-3 py-2">
      <p className="v2-type-caption text-pretty text-destructive">{message}</p>
    </div>
  );
}

function BrowserAutomationEmpty({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex h-full min-h-0 items-center justify-center px-6">
      <div className="max-w-sm text-center">
        <p className="v2-type-body-strong text-foreground">{title}</p>
        <p className="v2-type-panel-subtitle mt-1 text-pretty text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}
