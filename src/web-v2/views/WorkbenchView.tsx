import { ConversationThread } from '@web/components/conversation';
import type { ControlPlaneSessionDetail } from '@web/hooks/useControlPlaneSessionDetail';
import type { I18nMessageKey } from '@web/i18n';
import { useI18n } from '@web/i18n';
import type { AppSurfaceId, SettingsSectionId } from '@web/layout/types';

interface WorkbenchViewProps {
  activeSurfaceId: AppSurfaceId;
  activeSettingsSectionId: SettingsSectionId;
  selectedSession: ControlPlaneSessionDetail;
  selectedSessionLoading: boolean;
  selectedSessionSubmitting: boolean;
  selectedSessionRunning: boolean;
  selectedSessionLiveStatus?: string;
  selectedSessionError?: string;
  settingsOpen: boolean;
  onSubmitSessionPrompt: (prompt: string) => Promise<void>;
}

const appSurfaceLabelKeys = {
  sessions: 'surface.sessions',
  tasks: 'surface.tasks',
} satisfies Record<AppSurfaceId, I18nMessageKey>;

const settingsSectionLabelKeys = {
  general: 'settings.general',
  workspaces: 'settings.workspaces',
  memory: 'settings.memory',
} satisfies Record<SettingsSectionId, I18nMessageKey>;

// WorkbenchView renders the selected v2 surface while keeping data loading in
// shell-level hooks so route views stay presentational.
export function WorkbenchView({
  activeSurfaceId,
  activeSettingsSectionId,
  selectedSession,
  selectedSessionLoading,
  selectedSessionSubmitting,
  selectedSessionRunning,
  selectedSessionLiveStatus,
  selectedSessionError,
  settingsOpen,
  onSubmitSessionPrompt,
}: WorkbenchViewProps) {
  const { t } = useI18n();
  const title =
    !settingsOpen && activeSurfaceId === 'sessions' && selectedSession ?
      selectedSession.name
    : t(settingsOpen ? settingsSectionLabelKeys[activeSettingsSectionId] : appSurfaceLabelKeys[activeSurfaceId]);

  const testId =
    settingsOpen ? `web-v2-settings-${activeSettingsSectionId}` : `web-v2-surface-${activeSurfaceId}`;

  return (
    <section className="flex h-full min-w-0 flex-col bg-background" data-testid={testId}>
      <header className="v2-panel-header">
        <h1 className="text-balance text-sm font-medium" data-testid="web-v2-workbench-title">{title}</h1>
      </header>
      <div
        className="min-h-0 flex-1 bg-background"
        aria-label={`${title} ${t('workbench.workspaceAriaLabel')}`}
        data-testid="web-v2-workbench-body"
      >
        {!settingsOpen && activeSurfaceId === 'sessions' ? (
          <ConversationThread
            emptyTitle={t('workbench.emptyConversation')}
            error={selectedSessionError}
            liveStatus={selectedSessionLiveStatus}
            loading={selectedSessionLoading}
            running={selectedSessionRunning}
            session={selectedSession}
            submitting={selectedSessionSubmitting}
            onSubmitPrompt={onSubmitSessionPrompt}
          />
        ) : null}
      </div>
    </section>
  );
}
