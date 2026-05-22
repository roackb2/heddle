import { ConversationThread } from '@web/components/conversation';
import type {
  ControlPlaneApprovalDecision,
  ControlPlanePendingApproval,
  ControlPlaneSessionDetail,
} from '@web/hooks/useControlPlaneSessionDetail';
import type { I18nMessageKey } from '@web/i18n';
import { useI18n } from '@web/i18n';
import type { AppSurfaceId, SettingsSectionId } from '@web/layout/types';

interface WorkbenchViewProps {
  activeSurfaceId: AppSurfaceId;
  activeSettingsSectionId: SettingsSectionId;
  selectedSession: ControlPlaneSessionDetail;
  selectedSessionLoading: boolean;
  selectedSessionSubmitting: boolean;
  selectedSessionLiveStatus?: string;
  selectedSessionPendingApproval: ControlPlanePendingApproval;
  selectedSessionApprovalResolving: boolean;
  selectedSessionApprovalError?: string;
  settingsOpen: boolean;
  onSubmitSessionPrompt: (prompt: string) => Promise<void>;
  onResolveSessionApproval: (decision: ControlPlaneApprovalDecision) => Promise<void>;
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
  selectedSessionLiveStatus,
  selectedSessionPendingApproval,
  selectedSessionApprovalResolving,
  selectedSessionApprovalError,
  settingsOpen,
  onSubmitSessionPrompt,
  onResolveSessionApproval,
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
        <h1 className="v2-type-panel-title text-balance" data-testid="web-v2-workbench-title">{title}</h1>
      </header>
      <div
        className="min-h-0 flex-1 bg-background"
        aria-label={`${title} ${t('workbench.workspaceAriaLabel')}`}
        data-testid="web-v2-workbench-body"
      >
        {!settingsOpen && activeSurfaceId === 'sessions' ? (
          <ConversationThread
            emptyTitle={t('workbench.emptyConversation')}
            liveStatus={selectedSessionLiveStatus}
            loading={selectedSessionLoading}
            pendingApproval={selectedSessionPendingApproval}
            approvalResolving={selectedSessionApprovalResolving}
            approvalError={selectedSessionApprovalError}
            session={selectedSession}
            submitting={selectedSessionSubmitting}
            onSubmitPrompt={onSubmitSessionPrompt}
            onResolveApproval={onResolveSessionApproval}
          />
        ) : null}
      </div>
    </section>
  );
}
