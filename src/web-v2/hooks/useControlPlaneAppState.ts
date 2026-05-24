import type { ControlPlaneHeartbeatTaskView } from '@web/api/client';
import { trpcReact } from '@web/api/client';
import { useControlPlaneErrorToasts } from './useControlPlaneErrorToasts';
import { useControlPlaneHeartbeatEvents } from './tasks/useControlPlaneHeartbeatEvents';
import { useControlPlaneSessionDetail } from './sessions/useControlPlaneSessionDetail';
import { useControlPlaneSidebarData } from './shell/useControlPlaneSidebarData';
import { useControlPlaneTaskActions } from './tasks/useControlPlaneTaskActions';
import { useControlPlaneTaskSelection } from './tasks/useControlPlaneTaskSelection';
import { useWorkbenchNavigation } from './useWorkbenchNavigation';

export type ControlPlaneRightPanelProps = {
  activeRouteMode: ReturnType<typeof useWorkbenchNavigation>['activeRouteMode'];
  taskRun: {
    error?: string;
    liveTask?: ControlPlaneHeartbeatTaskView;
    loading: boolean;
    run: ReturnType<typeof useControlPlaneTaskSelection>['runDetail']['run'];
    selectedRunId?: string;
  };
};

export function useControlPlaneAppState() {
  const navigation = useWorkbenchNavigation();
  const utils = trpcReact.useUtils();
  const createSessionMutation = trpcReact.controlPlane.sessionCreate.useMutation();
  const taskEvents = useControlPlaneHeartbeatEvents();
  const sidebar = useControlPlaneSidebarData({ navigation, taskEvents });
  const selectedSession = useControlPlaneSessionDetail(navigation.selectedSessionId);
  const taskSelection = useControlPlaneTaskSelection({ navigation, taskEvents });
  const taskActions = useControlPlaneTaskActions({
    navigation,
    selectedTask: taskSelection.task,
    sidebarTasks: sidebar.tasks,
    taskEvents,
  });

  useControlPlaneErrorToasts({
    stateError: sidebar.stateQuery.error,
    sessionError: selectedSession.error,
  });

  async function createSession() {
    const session = await createSessionMutation.mutateAsync();
    navigation.selectSession(session.id);
    await utils.controlPlane.state.invalidate();
  }

  return {
    frameProps: {
      activeSurfaceId: navigation.activeSurfaceId,
      activeSettingsSectionId: navigation.activeSettingsSectionId,
      settingsOpen: navigation.settingsOpen,
      selectedSessionId: navigation.selectedSessionId,
      selectedTaskId: navigation.selectedTaskId,
      sessions: sidebar.sessions,
      tasks: sidebar.tasks,
      onOpenSettings: navigation.openSettings,
      onCloseSettings: navigation.closeSettings,
      onCreateSession: createSession,
      onCreateTask: taskActions.openCreateDialog,
      onSelectSession: navigation.selectSession,
      onSelectTask: navigation.selectTask,
    },
    routeProps: {
      activeSurfaceId: navigation.activeSurfaceId,
      activeSettingsSectionId: navigation.activeSettingsSectionId,
      sessionView: {
        session: selectedSession.session,
        loading: selectedSession.loading,
        submitting: selectedSession.submitting,
        liveStatus: selectedSession.liveStatus,
        pendingApproval: selectedSession.pendingApproval,
        approvalResolving: selectedSession.approvalResolving,
        approvalError: selectedSession.approvalError,
        modelOptions: selectedSession.modelOptions,
        settingsUpdating: selectedSession.settingsUpdating,
        settingsError: selectedSession.settingsError,
        onSubmitPrompt: selectedSession.submitPrompt,
        onUpdateDriftEnabled: selectedSession.updateDriftEnabled,
        onUpdateModel: selectedSession.updateModel,
        onUpdateReasoningEffort: selectedSession.updateReasoningEffort,
        onResolveApproval: selectedSession.resolvePendingApproval,
      },
      taskView: {
        task: taskSelection.task,
        runs: taskSelection.runs,
        selectedRunId: taskSelection.selectedRunId,
        loading: taskSelection.loading,
        error: taskSelection.error,
        running: taskActions.taskSubmitting,
        onEditTask: taskActions.openEditDialog,
        onDeleteTask: taskActions.openDeleteDialog,
        onRunNow: taskActions.runSelectedTaskNow,
        onResumeTask: taskActions.resumeSelectedTask,
        onSetTaskEnabled: taskActions.setSelectedTaskEnabled,
        onSelectRun: taskSelection.selectRun,
      },
    },
    rightPanelProps: {
      activeRouteMode: navigation.activeRouteMode,
      taskRun: {
        error: taskSelection.runDetail.error,
        liveTask: taskSelection.task,
        loading: taskSelection.runDetail.loading,
        run: taskSelection.runDetail.run,
        selectedRunId: taskSelection.selectedRunId,
      },
    } satisfies ControlPlaneRightPanelProps,
    taskCreateDialogProps: taskActions.createDialogProps,
    taskDeleteDialogProps: taskActions.deleteDialogProps,
    taskEditDialogProps: taskActions.editDialogProps,
  };
}
