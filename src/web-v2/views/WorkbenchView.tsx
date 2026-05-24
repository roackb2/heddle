import { ConversationThread } from '@web/components/conversation';
import type { ControlPlaneHeartbeatRunView, ControlPlaneHeartbeatTask, ControlPlaneModelOptions } from '@web/api/client';
import type { ReactNode } from 'react';
import type {
  ControlPlaneApprovalDecision,
  ControlPlaneReasoningEffortSelection,
  ControlPlanePendingApproval,
  ControlPlaneSessionDetail,
} from '@web/hooks/useControlPlaneSessionDetail';
import type { I18nMessageKey } from '@web/i18n';
import { useI18n } from '@web/i18n';
import type { AppSurfaceId, SettingsSectionId } from '@web/layout/types';
import { TasksWorkbenchView } from './TasksWorkbenchView';

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
  selectedSessionModelOptions?: ControlPlaneModelOptions;
  selectedSessionSettingsUpdating: boolean;
  selectedSessionSettingsError?: string;
  selectedTask: ControlPlaneHeartbeatTask['task'] | undefined;
  selectedTaskRuns: ControlPlaneHeartbeatRunView[];
  selectedTaskRunId?: string;
  selectedTaskLoading: boolean;
  selectedTaskError?: string;
  selectedTaskRunSubmitting: boolean;
  settingsOpen: boolean;
  onSubmitSessionPrompt: (prompt: string) => Promise<void>;
  onUpdateSessionModel: (model: string) => Promise<void>;
  onUpdateSessionReasoningEffort: (value: ControlPlaneReasoningEffortSelection) => Promise<void>;
  onResolveSessionApproval: (decision: ControlPlaneApprovalDecision) => Promise<void>;
  onEditTask: () => void;
  onRunTaskNow: () => Promise<void>;
  onSelectTaskRun: (runId: string) => void;
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
  selectedSessionModelOptions,
  selectedSessionSettingsUpdating,
  selectedSessionSettingsError,
  selectedTask,
  selectedTaskRuns,
  selectedTaskRunId,
  selectedTaskLoading,
  selectedTaskError,
  selectedTaskRunSubmitting,
  settingsOpen,
  onSubmitSessionPrompt,
  onUpdateSessionModel,
  onUpdateSessionReasoningEffort,
  onResolveSessionApproval,
  onEditTask,
  onRunTaskNow,
  onSelectTaskRun,
}: WorkbenchViewProps) {
  const { t } = useI18n();
  const surfaceTitles = {
    sessions: selectedSession?.name ?? t(appSurfaceLabelKeys.sessions),
    tasks: selectedTask?.name ?? selectedTask?.task ?? t(appSurfaceLabelKeys.tasks),
  } satisfies Record<AppSurfaceId, string>;
  const title = settingsOpen ? t(settingsSectionLabelKeys[activeSettingsSectionId]) : surfaceTitles[activeSurfaceId];

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
        {renderWorkbenchSurface({
          activeSurfaceId,
          selectedSession,
          selectedSessionLoading,
          selectedSessionSubmitting,
          selectedSessionLiveStatus,
          selectedSessionPendingApproval,
          selectedSessionApprovalResolving,
          selectedSessionApprovalError,
          selectedSessionModelOptions,
          selectedSessionSettingsUpdating,
          selectedSessionSettingsError,
          selectedTask,
          selectedTaskRuns,
          selectedTaskRunId,
          selectedTaskLoading,
          selectedTaskError,
          selectedTaskRunSubmitting,
          settingsOpen,
          t,
          onSubmitSessionPrompt,
          onUpdateSessionModel,
          onUpdateSessionReasoningEffort,
          onResolveSessionApproval,
          onEditTask,
          onRunTaskNow,
          onSelectTaskRun,
        })}
      </div>
    </section>
  );
}

type RenderWorkbenchSurfaceArgs = Omit<WorkbenchViewProps, 'activeSettingsSectionId'> & {
  t: ReturnType<typeof useI18n>['t'];
};

function renderWorkbenchSurface(args: RenderWorkbenchSurfaceArgs): ReactNode {
  if (args.settingsOpen) {
    return null;
  }

  const renderers = {
    sessions: () => (
      <ConversationThread
        emptyTitle={args.t('workbench.emptyConversation')}
        liveStatus={args.selectedSessionLiveStatus}
        loading={args.selectedSessionLoading}
        pendingApproval={args.selectedSessionPendingApproval}
        approvalResolving={args.selectedSessionApprovalResolving}
        approvalError={args.selectedSessionApprovalError}
        modelOptions={args.selectedSessionModelOptions}
        settingsUpdating={args.selectedSessionSettingsUpdating}
        settingsError={args.selectedSessionSettingsError}
        session={args.selectedSession}
        submitting={args.selectedSessionSubmitting}
        onSubmitPrompt={args.onSubmitSessionPrompt}
        onUpdateModel={args.onUpdateSessionModel}
        onUpdateReasoningEffort={args.onUpdateSessionReasoningEffort}
        onResolveApproval={args.onResolveSessionApproval}
      />
    ),
    tasks: () => (
      <TasksWorkbenchView
        error={args.selectedTaskError}
        loading={args.selectedTaskLoading}
        runs={args.selectedTaskRuns}
        selectedRunId={args.selectedTaskRunId}
        running={args.selectedTaskRunSubmitting}
        task={args.selectedTask}
        onEditTask={args.onEditTask}
        onRunNow={args.onRunTaskNow}
        onSelectRun={args.onSelectTaskRun}
      />
    ),
  } satisfies Record<AppSurfaceId, () => ReactNode>;

  return renderers[args.activeSurfaceId]();
}
