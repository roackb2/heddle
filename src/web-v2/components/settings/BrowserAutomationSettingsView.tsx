import { useState } from 'react';
import type { ControlPlaneBrowserAutomation } from '@web/api/client';
import { Button } from '@web/components/ui/button';
import { Input } from '@web/components/ui/input';
import { Switch } from '@web/components/ui/switch';
import { useI18n } from '@web/i18n';
import { cn } from '@web/lib/utils';

export interface BrowserAutomationSettingsViewProps {
  browserAutomation?: ControlPlaneBrowserAutomation;
  loading: boolean;
  error?: string;
  updating: boolean;
  onSetEnabled: (enabled: boolean) => Promise<void>;
  onUpdateSettings: (input: {
    profileId?: string;
    backend?: 'playwright-managed' | 'native-chrome-cdp';
    channel?: 'chromium' | 'chrome' | 'msedge';
    headless?: boolean;
    cdpEndpoint?: string;
  }) => Promise<void>;
  onOpenProfile: (url?: string) => Promise<void>;
  onCloseProfile: () => Promise<void>;
  onLaunchNativeChrome: (url?: string) => Promise<void>;
  onCheckNativeChrome: () => Promise<void>;
}

const BROWSER_CHANNEL_OPTIONS = [
  { channel: 'chromium', labelKey: 'browserAutomationSettings.channel.chromium' },
  { channel: 'chrome', labelKey: 'browserAutomationSettings.channel.chrome' },
  { channel: 'msedge', labelKey: 'browserAutomationSettings.channel.msedge' },
] as const;

const BROWSER_BACKEND_OPTIONS = [
  { backend: 'playwright-managed', labelKey: 'browserAutomationSettings.backend.playwright' },
  { backend: 'native-chrome-cdp', labelKey: 'browserAutomationSettings.backend.nativeChrome' },
] as const;

export function BrowserAutomationSettingsView({
  browserAutomation,
  loading,
  error,
  updating,
  onSetEnabled,
  onUpdateSettings,
  onOpenProfile,
  onCloseProfile,
  onLaunchNativeChrome,
  onCheckNativeChrome,
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
  const browserSettings = browserAutomation?.browserSettings;

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

        {browserSettings ? (
          <BrowserProfileSettingsPanel
            disabled={updating}
            onError={setActionError}
            onCloseProfile={onCloseProfile}
            onCheckNativeChrome={onCheckNativeChrome}
            onLaunchNativeChrome={onLaunchNativeChrome}
            onOpenProfile={onOpenProfile}
            onUpdateSettings={onUpdateSettings}
            nativeChrome={browserAutomation.nativeChrome}
            settings={browserSettings}
            windowStatus={browserAutomation.profileWindow}
          />
        ) : null}

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
            {browserSettings ? (
              <>
                <BrowserAutomationDetailRow
                  label={t('browserAutomationSettings.profilePathLabel')}
                  value={browserSettings.userDataDir}
                />
                <BrowserAutomationDetailRow
                  label={t('browserAutomationSettings.settingsPathLabel')}
                  value={browserSettings.settingsStorePath}
                />
                <BrowserAutomationDetailRow
                  label={t('browserAutomationSettings.evidenceLabel')}
                  value={browserSettings.evidenceNote}
                />
              </>
            ) : null}
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

function BrowserProfileSettingsPanel({
  disabled,
  onError,
  onCloseProfile,
  onCheckNativeChrome,
  onLaunchNativeChrome,
  onOpenProfile,
  onUpdateSettings,
  nativeChrome,
  settings,
  windowStatus,
}: {
  disabled: boolean;
  onError: (error: string | undefined) => void;
  onCheckNativeChrome: BrowserAutomationSettingsViewProps['onCheckNativeChrome'];
  onCloseProfile: BrowserAutomationSettingsViewProps['onCloseProfile'];
  onLaunchNativeChrome: BrowserAutomationSettingsViewProps['onLaunchNativeChrome'];
  onOpenProfile: BrowserAutomationSettingsViewProps['onOpenProfile'];
  onUpdateSettings: BrowserAutomationSettingsViewProps['onUpdateSettings'];
  nativeChrome: ControlPlaneBrowserAutomation['nativeChrome'];
  settings: NonNullable<ControlPlaneBrowserAutomation['browserSettings']>;
  windowStatus: ControlPlaneBrowserAutomation['profileWindow'];
}) {
  const { t } = useI18n();

  return (
    <section className="min-w-0">
      <h2 className="v2-type-section-label mb-3 text-muted-foreground">{t('browserAutomationSettings.profileSectionTitle')}</h2>
      <div className="v2-settings-group">
        <BrowserProfileIdRow
          key={settings.profileId}
          disabled={disabled}
          onError={onError}
          onUpdateSettings={onUpdateSettings}
          profileId={settings.profileId}
        />
        <BrowserBackendRow
          disabled={disabled}
          onError={onError}
          onUpdateSettings={onUpdateSettings}
          selectedBackend={settings.backendSelection}
        />
        <BrowserCdpEndpointRow
          cdpEndpoint={settings.cdpEndpoint ?? ''}
          disabled={disabled || settings.backendSelection !== 'native-chrome-cdp'}
          onError={onError}
          onUpdateSettings={onUpdateSettings}
        />
        <BrowserChannelRow
          disabled={disabled || settings.backendSelection !== 'playwright-managed'}
          onError={onError}
          onUpdateSettings={onUpdateSettings}
          selectedChannel={settings.channelSelection}
        />
        <div className="v2-settings-row">
          <div className="min-w-0">
            <p className="v2-type-body-strong text-foreground">{t('browserAutomationSettings.displayModeTitle')}</p>
            <p className="v2-type-panel-subtitle mt-1 max-w-2xl text-pretty text-muted-foreground">
              {t('browserAutomationSettings.displayModeDetail')}
            </p>
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <Button
              aria-pressed={settings.headless}
              disabled={disabled}
              onClick={() => {
                if (!settings.headless) {
                  void updateDisplayMode({ onError, onUpdateSettings, headless: true });
                }
              }}
              size="sm"
              type="button"
              variant={settings.headless ? 'default' : 'outline'}
            >
              {t('browserAutomationSettings.headlessAction')}
            </Button>
            <Button
              aria-pressed={!settings.headless}
              disabled={disabled}
              onClick={() => {
                if (settings.headless) {
                  void updateDisplayMode({ onError, onUpdateSettings, headless: false });
                }
              }}
              size="sm"
              type="button"
              variant={!settings.headless ? 'default' : 'outline'}
            >
              {t('browserAutomationSettings.headedAction')}
            </Button>
          </div>
        </div>
        <div className="v2-settings-row">
          <div className="min-w-0">
            <p className="v2-type-caption text-muted-foreground">{t('browserAutomationSettings.knownProfilesLabel')}</p>
            <p className="v2-type-panel-subtitle mt-1 text-pretty text-foreground">
              {settings.profiles.map((profile) => profile.profileId).join(', ') || settings.profileId}
            </p>
          </div>
        </div>
        <div className="v2-settings-row">
          <div className="min-w-0">
            <p className="v2-type-caption text-muted-foreground">{t('browserAutomationSettings.loginFlowLabel')}</p>
            <p className="v2-type-panel-subtitle mt-1 text-pretty text-foreground">{settings.profileInstruction}</p>
          </div>
        </div>
        {settings.backendSelection === 'native-chrome-cdp' ? (
          <NativeChromeRow
            disabled={disabled}
            nativeChrome={nativeChrome}
            onCheckNativeChrome={onCheckNativeChrome}
            onError={onError}
            onLaunchNativeChrome={onLaunchNativeChrome}
          />
        ) : (
          <BrowserProfileWindowRow
            disabled={disabled}
            onCloseProfile={onCloseProfile}
            onError={onError}
            onOpenProfile={onOpenProfile}
            windowStatus={windowStatus}
          />
        )}
      </div>
    </section>
  );
}

function NativeChromeRow({
  disabled,
  nativeChrome,
  onCheckNativeChrome,
  onError,
  onLaunchNativeChrome,
}: {
  disabled: boolean;
  nativeChrome: ControlPlaneBrowserAutomation['nativeChrome'];
  onCheckNativeChrome: BrowserAutomationSettingsViewProps['onCheckNativeChrome'];
  onError: (error: string | undefined) => void;
  onLaunchNativeChrome: BrowserAutomationSettingsViewProps['onLaunchNativeChrome'];
}) {
  const { t } = useI18n();
  const [url, setUrl] = useState(nativeChrome.defaultStartUrl);

  async function launchNativeChrome() {
    try {
      onError(undefined);
      await onLaunchNativeChrome(url.trim() || undefined);
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    }
  }

  async function checkNativeChrome() {
    try {
      onError(undefined);
      await onCheckNativeChrome();
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <div className="v2-settings-row items-start">
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <p className="v2-type-body-strong text-foreground">{t('browserAutomationSettings.nativeChromeTitle')}</p>
          <span
            className={cn(
              'v2-type-caption shrink-0 rounded-sm border px-1.5 py-0.5',
              nativeChrome.state === 'reachable'
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                : 'border-border bg-muted/20 text-muted-foreground',
            )}
          >
            {nativeChrome.state === 'reachable'
              ? t('browserAutomationSettings.nativeChromeReachable')
              : t('browserAutomationSettings.nativeChromeUnreachable')}
          </span>
        </div>
        <p className="v2-type-panel-subtitle mt-1 max-w-2xl text-pretty text-muted-foreground">
          {t('browserAutomationSettings.nativeChromeDetail')}
        </p>
        <p className="v2-type-caption mt-2 break-all text-muted-foreground">
          {nativeChrome.endpoint}
        </p>
        {nativeChrome.browser ? (
          <p className="v2-type-caption mt-1 break-all text-muted-foreground">{nativeChrome.browser}</p>
        ) : null}
      </div>
      <div className="flex w-full min-w-0 max-w-md flex-col gap-2">
        <Input
          disabled={disabled}
          onChange={(event) => setUrl(event.target.value)}
          placeholder={nativeChrome.defaultStartUrl}
          value={url}
        />
        <div className="flex min-w-0 items-center justify-end gap-2">
          <Button
            disabled={disabled}
            onClick={() => void checkNativeChrome()}
            size="sm"
            type="button"
            variant="outline"
          >
            {t('browserAutomationSettings.nativeChromeCheckAction')}
          </Button>
          <Button
            disabled={disabled}
            onClick={() => void launchNativeChrome()}
            size="sm"
            type="button"
            variant="default"
          >
            {t('browserAutomationSettings.nativeChromeLaunchAction')}
          </Button>
        </div>
      </div>
    </div>
  );
}

function BrowserBackendRow({
  disabled,
  onError,
  onUpdateSettings,
  selectedBackend,
}: {
  disabled: boolean;
  onError: (error: string | undefined) => void;
  onUpdateSettings: BrowserAutomationSettingsViewProps['onUpdateSettings'];
  selectedBackend: 'playwright-managed' | 'native-chrome-cdp';
}) {
  const { t } = useI18n();

  async function updateBackend(backend: 'playwright-managed' | 'native-chrome-cdp') {
    try {
      onError(undefined);
      await onUpdateSettings({ backend });
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <div className="v2-settings-row">
      <div className="min-w-0">
        <p className="v2-type-body-strong text-foreground">{t('browserAutomationSettings.backendTitle')}</p>
        <p className="v2-type-panel-subtitle mt-1 max-w-2xl text-pretty text-muted-foreground">
          {t('browserAutomationSettings.backendDetail')}
        </p>
      </div>
      <div className="flex min-w-0 items-center gap-2">
        {BROWSER_BACKEND_OPTIONS.map((option) => (
          <Button
            aria-pressed={selectedBackend === option.backend}
            disabled={disabled}
            key={option.backend}
            onClick={() => {
              if (selectedBackend !== option.backend) {
                void updateBackend(option.backend);
              }
            }}
            size="sm"
            type="button"
            variant={selectedBackend === option.backend ? 'default' : 'outline'}
          >
            {t(option.labelKey)}
          </Button>
        ))}
      </div>
    </div>
  );
}

function BrowserCdpEndpointRow({
  cdpEndpoint,
  disabled,
  onError,
  onUpdateSettings,
}: {
  cdpEndpoint: string;
  disabled: boolean;
  onError: (error: string | undefined) => void;
  onUpdateSettings: BrowserAutomationSettingsViewProps['onUpdateSettings'];
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(cdpEndpoint);

  async function saveEndpoint() {
    try {
      onError(undefined);
      await onUpdateSettings({ cdpEndpoint: draft });
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <div className="v2-settings-row items-start">
      <div className="min-w-0 flex-1">
        <label className="v2-type-body-strong text-foreground" htmlFor="browser-cdp-endpoint">
          {t('browserAutomationSettings.cdpEndpointTitle')}
        </label>
        <p className="v2-type-panel-subtitle mt-1 max-w-2xl text-pretty text-muted-foreground">
          {t('browserAutomationSettings.cdpEndpointDetail')}
        </p>
      </div>
      <div className="flex w-full min-w-0 max-w-md items-center gap-2">
        <Input
          className="min-w-0"
          disabled={disabled}
          id="browser-cdp-endpoint"
          onChange={(event) => setDraft(event.target.value)}
          placeholder="http://127.0.0.1:9223"
          value={draft}
        />
        <Button
          disabled={disabled || draft.trim() === cdpEndpoint}
          onClick={() => void saveEndpoint()}
          size="sm"
          type="button"
          variant="outline"
        >
          {t('browserAutomationSettings.saveProfileAction')}
        </Button>
      </div>
    </div>
  );
}

function BrowserChannelRow({
  disabled,
  onError,
  onUpdateSettings,
  selectedChannel,
}: {
  disabled: boolean;
  onError: (error: string | undefined) => void;
  onUpdateSettings: BrowserAutomationSettingsViewProps['onUpdateSettings'];
  selectedChannel: 'chromium' | 'chrome' | 'msedge';
}) {
  const { t } = useI18n();

  async function updateChannel(channel: 'chromium' | 'chrome' | 'msedge') {
    try {
      onError(undefined);
      await onUpdateSettings({ channel });
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <div className="v2-settings-row">
      <div className="min-w-0">
        <p className="v2-type-body-strong text-foreground">{t('browserAutomationSettings.channelTitle')}</p>
        <p className="v2-type-panel-subtitle mt-1 max-w-2xl text-pretty text-muted-foreground">
          {t('browserAutomationSettings.channelDetail')}
        </p>
      </div>
      <div className="flex min-w-0 items-center gap-2">
        {BROWSER_CHANNEL_OPTIONS.map((option) => (
          <Button
            aria-pressed={selectedChannel === option.channel}
            disabled={disabled}
            key={option.channel}
            onClick={() => {
              if (selectedChannel !== option.channel) {
                void updateChannel(option.channel);
              }
            }}
            size="sm"
            type="button"
            variant={selectedChannel === option.channel ? 'default' : 'outline'}
          >
            {t(option.labelKey)}
          </Button>
        ))}
      </div>
    </div>
  );
}

function BrowserProfileWindowRow({
  disabled,
  onCloseProfile,
  onError,
  onOpenProfile,
  windowStatus,
}: {
  disabled: boolean;
  onCloseProfile: BrowserAutomationSettingsViewProps['onCloseProfile'];
  onError: (error: string | undefined) => void;
  onOpenProfile: BrowserAutomationSettingsViewProps['onOpenProfile'];
  windowStatus: ControlPlaneBrowserAutomation['profileWindow'];
}) {
  const { t } = useI18n();
  const [url, setUrl] = useState('');

  async function openProfile() {
    try {
      onError(undefined);
      await onOpenProfile(url.trim() || undefined);
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    }
  }

  async function closeProfile() {
    try {
      onError(undefined);
      await onCloseProfile();
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <div className="v2-settings-row items-start">
      <div className="min-w-0 flex-1">
        <p className="v2-type-body-strong text-foreground">{t('browserAutomationSettings.profileWindowTitle')}</p>
        <p className="v2-type-panel-subtitle mt-1 max-w-2xl text-pretty text-muted-foreground">
          {windowStatus.open
            ? t('browserAutomationSettings.profileWindowOpenDetail')
            : t('browserAutomationSettings.profileWindowClosedDetail')}
        </p>
        <p className="v2-type-caption mt-2 break-all text-muted-foreground">
          {windowStatus.open
            ? `${t('browserAutomationSettings.profileWindowStatusOpen')}${windowStatus.currentUrl ? ` · ${windowStatus.currentUrl}` : ''}`
            : t('browserAutomationSettings.profileWindowStatusClosed')}
        </p>
      </div>
      <div className="flex w-full min-w-0 max-w-md flex-col gap-2">
        <Input
          disabled={disabled}
          onChange={(event) => setUrl(event.target.value)}
          placeholder={t('browserAutomationSettings.profileWindowUrlPlaceholder')}
          value={url}
        />
        <div className="flex min-w-0 items-center justify-end gap-2">
          <Button
            disabled={disabled}
            onClick={() => void openProfile()}
            size="sm"
            type="button"
            variant={windowStatus.open ? 'outline' : 'default'}
          >
            {windowStatus.open
              ? t('browserAutomationSettings.profileWindowNavigateAction')
              : t('browserAutomationSettings.profileWindowOpenAction')}
          </Button>
          <Button
            disabled={disabled || !windowStatus.open}
            onClick={() => void closeProfile()}
            size="sm"
            type="button"
            variant="outline"
          >
            {t('browserAutomationSettings.profileWindowCloseAction')}
          </Button>
        </div>
      </div>
    </div>
  );
}

function BrowserProfileIdRow({
  disabled,
  onError,
  onUpdateSettings,
  profileId,
}: {
  disabled: boolean;
  onError: (error: string | undefined) => void;
  onUpdateSettings: BrowserAutomationSettingsViewProps['onUpdateSettings'];
  profileId: string;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(profileId);

  async function saveProfileId() {
    try {
      onError(undefined);
      await onUpdateSettings({ profileId: draft });
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <div className="v2-settings-row items-start">
      <div className="min-w-0 flex-1">
        <label className="v2-type-body-strong text-foreground" htmlFor="browser-profile-id">
          {t('browserAutomationSettings.profileIdTitle')}
        </label>
        <p className="v2-type-panel-subtitle mt-1 max-w-2xl text-pretty text-muted-foreground">
          {t('browserAutomationSettings.profileIdDetail')}
        </p>
      </div>
      <div className="flex w-full min-w-0 max-w-sm items-center gap-2">
        <Input
          className="min-w-0"
          disabled={disabled}
          id="browser-profile-id"
          onChange={(event) => setDraft(event.target.value)}
          value={draft}
        />
        <Button
          disabled={disabled || draft.trim() === profileId}
          onClick={() => void saveProfileId()}
          size="sm"
          type="button"
          variant="outline"
        >
          {t('browserAutomationSettings.saveProfileAction')}
        </Button>
      </div>
    </div>
  );
}

async function updateDisplayMode({
  headless,
  onError,
  onUpdateSettings,
}: {
  headless: boolean;
  onError: (error: string | undefined) => void;
  onUpdateSettings: BrowserAutomationSettingsViewProps['onUpdateSettings'];
}) {
  try {
    onError(undefined);
    await onUpdateSettings({ headless });
  } catch (error) {
    onError(error instanceof Error ? error.message : String(error));
  }
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
