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
  workspaceId?: string;
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
  const taskEvents = useControlPlaneHeartbeatEvents(navigation.selectedWorkspaceId);
  const sidebar = useControlPlaneSidebarData({ navigation, taskEvents });
  const memoryStatusQuery = trpcReact.controlPlane.memoryStatus.useQuery(sidebar.workspaceId ? { workspaceId: sidebar.workspaceId } : undefined, {
    enabled: navigation.settingsOpen && navigation.activeSettingsSectionId === 'memory',
  });
  const selectedSession = useControlPlaneSessionDetail({
    workspaceId: sidebar.workspaceId,
    sessionId: navigation.selectedSessionId,
  });
  const taskSelection = useControlPlaneTaskSelection({
    navigation,
    taskEvents,
    workspaceId: sidebar.workspaceId,
  });
  const taskActions = useControlPlaneTaskActions({
    navigation,
    selectedTask: taskSelection.task,
    sidebarTasks: sidebar.tasks,
    taskEvents,
    workspaceId: sidebar.workspaceId,
  });
  const state = sidebar.stateQuery.data;
  const stateMemoryStatus = state && state.activeWorkspaceId === sidebar.workspaceId ? state.memory : undefined;

  useControlPlaneErrorToasts({
    stateError: sidebar.stateQuery.error,
    sessionError: selectedSession.error,
  });

  async function createSession() {
    const session = await createSessionMutation.mutateAsync(
      sidebar.workspaceId ? { workspaceId: sidebar.workspaceId } : undefined,
    );
    navigation.selectSession(session.id, { workspaceId: sidebar.workspaceId });
    await utils.controlPlane.state.invalidate();
    await utils.controlPlane.sessions.invalidate(
      sidebar.workspaceId ? { workspaceId: sidebar.workspaceId } : undefined,
    );
  }

  return {
    frameProps: {
      activeSurfaceId: navigation.activeSurfaceId,
      activeSettingsSectionId: navigation.activeSettingsSectionId,
      settingsOpen: navigation.settingsOpen,
      selectedWorkspaceId: sidebar.workspaceId,
      selectedSessionId: navigation.selectedSessionId,
      selectedTaskId: navigation.selectedTaskId,
      workspaces: sidebar.stateQuery.data?.workspaces ?? [],
      sessions: sidebar.sessions,
      tasks: sidebar.tasks,
      onOpenSettings: navigation.openSettings,
      onOpenWorkspaceSettings: () => navigation.openSettings('workspaces'),
      onCloseSettings: navigation.closeSettings,
      onCreateSession: createSession,
      onCreateTask: taskActions.openCreateDialog,
      onSelectWorkspace: navigation.selectWorkspace,
      onSelectSession: navigation.selectSession,
      onSelectTask: navigation.selectTask,
    },
    routeProps: {
      activeSurfaceId: navigation.activeSurfaceId,
      activeSettingsSectionId: navigation.activeSettingsSectionId,
      memorySettingsView: {
        status: memoryStatusQuery.data ?? stateMemoryStatus,
        loading: memoryStatusQuery.isLoading || sidebar.stateQuery.isLoading,
        error: memoryStatusQuery.error instanceof Error ? memoryStatusQuery.error.message : undefined,
      },
      sessionView: {
        workspaceId: sidebar.workspaceId,
        session: selectedSession.session,
        loading: selectedSession.loading,
        submitting: selectedSession.submitting,
        running: selectedSession.running,
        cancelling: selectedSession.cancelling,
        liveStatus: selectedSession.liveStatus,
        pendingApproval: selectedSession.pendingApproval,
        approvalResolving: selectedSession.approvalResolving,
        approvalError: selectedSession.approvalError,
        modelOptions: selectedSession.modelOptions,
        settingsUpdating: selectedSession.settingsUpdating,
        settingsError: selectedSession.settingsError,
        onSubmitPrompt: selectedSession.submitPrompt,
        onCancelRun: selectedSession.cancelRun,
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
      workspaceId: sidebar.workspaceId,
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
