import { useEffect, useMemo, type ReactNode } from 'react';
import { trpcReact } from '@web/api/client';
import { TaskRunDetailsPanel } from '@web/components/tasks';
import { ContextInspector } from '@web/components/panels';
import { useControlPlaneErrorToasts } from '@web/hooks/useControlPlaneErrorToasts';
import { useControlPlaneSessionDetail } from '@web/hooks/useControlPlaneSessionDetail';
import { useControlPlaneTaskDetail } from '@web/hooks/useControlPlaneTaskDetail';
import { useControlPlaneTaskRunDetail } from '@web/hooks/useControlPlaneTaskRunDetail';
import { useWorkbenchNavigation } from '@web/hooks/useWorkbenchNavigation';
import { useI18n } from '@web/i18n';
import { AppFrame } from '@web/layout/AppFrame';
import { AppRoutes } from '@web/layout/AppRoutes';
import { APP_ROUTES, SETTINGS_ROUTES } from '@web/layout/routes';
import type { AppSurfaceId } from '@web/layout/types';

export function App() {
  const { t } = useI18n();
  const navigation = useWorkbenchNavigation();
  const utils = trpcReact.useUtils();
  const stateQuery = trpcReact.controlPlane.state.useQuery();
  const tasksQuery = trpcReact.controlPlane.heartbeatTasks.useQuery();
  const createSessionMutation = trpcReact.controlPlane.sessionCreate.useMutation();
  const sidebarSessions = useMemo(
    () => stateQuery.data?.sessions ?? [],
    [stateQuery.data?.sessions],
  );
  const sidebarTasks = useMemo(
    () => tasksQuery.data?.tasks ?? [],
    [tasksQuery.data?.tasks],
  );
  const selectedSessionId = navigation.selectedSessionId;
  const selectedSession = useControlPlaneSessionDetail(selectedSessionId);
  const selectedTask = useControlPlaneTaskDetail(navigation.selectedTaskId, navigation.selectedTaskRunId);
  const selectedTaskRunId = navigation.selectedTaskRunId ?? selectedTask.selectedRun?.runId;
  const selectedTaskRun = useControlPlaneTaskRunDetail(navigation.selectedTaskId, selectedTaskRunId);
  useControlPlaneErrorToasts({
    stateError: stateQuery.error,
    sessionError: selectedSession.error,
  });

  useEffect(() => {
    if (selectedSessionId || navigation.settingsOpen || navigation.activeSurfaceId !== 'sessions' || sidebarSessions.length === 0) {
      return;
    }

    navigation.selectSession(sidebarSessions[0]!.id, { replace: true });
  }, [navigation, selectedSessionId, sidebarSessions]);

  useEffect(() => {
    if (navigation.selectedTaskId || navigation.settingsOpen || navigation.activeSurfaceId !== 'tasks' || sidebarTasks.length === 0) {
      return;
    }

    navigation.selectTask(sidebarTasks[0]!.taskId, { replace: true });
  }, [navigation, sidebarTasks]);

  const rightPanelViews = {
    sessions: {
      ariaLabel: t('inspector.contextAriaLabel'),
      content: <ContextInspector />,
    },
    tasks: {
      ariaLabel: t('tasks.runDetailsAriaLabel'),
      content: (
        <TaskRunDetailsPanel
          error={selectedTaskRun.error}
          loading={selectedTaskRun.loading}
          run={selectedTaskRun.run}
        />
      ),
    },
    settings: {
      ariaLabel: '',
      content: null,
    },
  } satisfies Record<AppSurfaceId | 'settings', { ariaLabel: string; content: ReactNode }>;

  const activeRightPanel = rightPanelViews[navigation.activeRouteMode];

  async function createSession() {
    const session = await createSessionMutation.mutateAsync();
    navigation.selectSession(session.id);
    await utils.controlPlane.state.invalidate();
  }

  function selectTaskRun(runId: string) {
    if (!navigation.selectedTaskId) {
      return;
    }

    navigation.selectTaskRun(navigation.selectedTaskId, runId);
  }

  return (
    <AppFrame
      activeSurfaceId={navigation.activeSurfaceId}
      activeSettingsSectionId={navigation.activeSettingsSectionId}
      appNavigationItems={APP_ROUTES}
      settingsNavigationItems={SETTINGS_ROUTES}
      settingsOpen={navigation.settingsOpen}
      selectedSessionId={selectedSessionId}
      selectedTaskId={navigation.selectedTaskId}
      sessions={sidebarSessions}
      tasks={sidebarTasks}
      rightPanel={activeRightPanel.content}
      rightPanelAriaLabel={activeRightPanel.ariaLabel}
      onOpenSettings={navigation.openSettings}
      onCloseSettings={navigation.closeSettings}
      onCreateSession={createSession}
      onSelectSession={navigation.selectSession}
      onSelectTask={navigation.selectTask}
    >
      <AppRoutes
        activeSurfaceId={navigation.activeSurfaceId}
        activeSettingsSectionId={navigation.activeSettingsSectionId}
        selectedSession={selectedSession.session}
        selectedSessionLoading={selectedSession.loading}
        selectedSessionSubmitting={selectedSession.submitting}
        selectedSessionLiveStatus={selectedSession.liveStatus}
        selectedSessionPendingApproval={selectedSession.pendingApproval}
        selectedSessionApprovalResolving={selectedSession.approvalResolving}
        selectedSessionApprovalError={selectedSession.approvalError}
        selectedSessionModelOptions={selectedSession.modelOptions}
        selectedSessionSettingsUpdating={selectedSession.settingsUpdating}
        selectedSessionSettingsError={selectedSession.settingsError}
        selectedTask={selectedTask.task}
        selectedTaskRuns={selectedTask.runs}
        selectedTaskRunId={selectedTaskRunId}
        selectedTaskLoading={selectedTask.loading}
        selectedTaskError={selectedTask.error}
        onSubmitSessionPrompt={selectedSession.submitPrompt}
        onUpdateSessionModel={selectedSession.updateModel}
        onUpdateSessionReasoningEffort={selectedSession.updateReasoningEffort}
        onResolveSessionApproval={selectedSession.resolvePendingApproval}
        onSelectTaskRun={selectTaskRun}
      />
    </AppFrame>
  );
}
