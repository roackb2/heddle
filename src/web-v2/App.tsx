import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { trpcReact } from '@web/api/client';
import { TaskCreateDialog, TaskRunDetailsPanel, type TaskCreateInput } from '@web/components/tasks';
import { ContextInspector } from '@web/components/panels';
import { useControlPlaneErrorToasts } from '@web/hooks/useControlPlaneErrorToasts';
import { useControlPlaneHeartbeatEvents } from '@web/hooks/useControlPlaneHeartbeatEvents';
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
  const modelOptionsQuery = trpcReact.controlPlane.modelOptions.useQuery();
  const createSessionMutation = trpcReact.controlPlane.sessionCreate.useMutation();
  const createTaskMutation = trpcReact.controlPlane.heartbeatTaskCreate.useMutation();
  const updateTaskMutation = trpcReact.controlPlane.heartbeatTaskUpdate.useMutation();
  const runTaskNowMutation = trpcReact.controlPlane.heartbeatTaskRunNow.useMutation();
  const taskEvents = useControlPlaneHeartbeatEvents();
  const [taskCreateOpen, setTaskCreateOpen] = useState(false);
  const [taskCreateError, setTaskCreateError] = useState<string | undefined>();
  const [taskEditOpen, setTaskEditOpen] = useState(false);
  const [taskEditError, setTaskEditError] = useState<string | undefined>();
  const sidebarSessions = useMemo(
    () => stateQuery.data?.sessions ?? [],
    [stateQuery.data?.sessions],
  );
  const sidebarTasks = useMemo(
    () => (tasksQuery.data?.tasks ?? []).map((task) => applyLiveTaskState(task, taskEvents.liveTasks[task.taskId])),
    [taskEvents.liveTasks, tasksQuery.data?.tasks],
  );
  const selectedSessionId = navigation.selectedSessionId;
  const selectedSession = useControlPlaneSessionDetail(selectedSessionId);
  const selectedTask = useControlPlaneTaskDetail(navigation.selectedTaskId, navigation.selectedTaskRunId);
  const selectedTaskView = selectedTask.task ? applyLiveTaskState(selectedTask.task, taskEvents.liveTasks[selectedTask.task.taskId]) : undefined;
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
          liveTask={selectedTaskView}
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

  async function createTask(input: TaskCreateInput, options: { runNow: boolean }) {
    setTaskCreateError(undefined);
    try {
      const created = await createTaskMutation.mutateAsync(input);
      navigation.selectTask(created.task.taskId);
      await utils.controlPlane.heartbeatTasks.invalidate();
      await utils.controlPlane.state.invalidate();
      if (options.runNow) {
        taskEvents.markTaskRunQueued(created.task.taskId);
        await runTaskNowMutation.mutateAsync({ taskId: created.task.taskId });
      }
      setTaskCreateOpen(false);
    } catch (error) {
      setTaskCreateError(error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  async function updateSelectedTask(input: TaskCreateInput) {
    if (!navigation.selectedTaskId) {
      return;
    }

    setTaskEditError(undefined);
    try {
      const updated = await updateTaskMutation.mutateAsync({
        taskId: navigation.selectedTaskId,
        name: input.name,
        task: input.task,
        intervalMs: input.intervalMs,
        model: input.model ?? null,
        maxSteps: input.maxSteps ?? null,
      });
      await invalidateTaskViews(updated.task.taskId);
      setTaskEditOpen(false);
    } catch (error) {
      setTaskEditError(error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  async function runSelectedTaskNow() {
    if (!navigation.selectedTaskId) {
      return;
    }

    const taskId = navigation.selectedTaskId;
    taskEvents.markTaskRunQueued(taskId);
    await runTaskNowMutation.mutateAsync({ taskId });
  }

  async function invalidateTaskViews(taskId: string) {
    await Promise.all([
      utils.controlPlane.heartbeatTasks.invalidate(),
      utils.controlPlane.heartbeatTask.invalidate({ taskId }),
      utils.controlPlane.state.invalidate(),
    ]);
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
      onCreateTask={() => {
        setTaskCreateError(undefined);
        setTaskCreateOpen(true);
      }}
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
        selectedTask={selectedTaskView}
        selectedTaskRuns={selectedTask.runs}
        selectedTaskRunId={selectedTaskRunId}
        selectedTaskLoading={selectedTask.loading}
        selectedTaskError={selectedTask.error}
        selectedTaskRunSubmitting={runTaskNowMutation.isPending || selectedTaskView?.state.status === 'running'}
        onSubmitSessionPrompt={selectedSession.submitPrompt}
        onUpdateSessionModel={selectedSession.updateModel}
        onUpdateSessionReasoningEffort={selectedSession.updateReasoningEffort}
        onResolveSessionApproval={selectedSession.resolvePendingApproval}
        onEditTask={() => {
          setTaskEditError(undefined);
          setTaskEditOpen(true);
        }}
        onRunTaskNow={runSelectedTaskNow}
        onSelectTaskRun={selectTaskRun}
      />
      <TaskCreateDialog
        error={taskCreateError}
        modelOptions={modelOptionsQuery.data}
        open={taskCreateOpen}
        submitting={createTaskMutation.isPending || runTaskNowMutation.isPending}
        onOpenChange={setTaskCreateOpen}
        onSubmit={createTask}
      />
      <TaskCreateDialog
        error={taskEditError}
        initialTask={selectedTaskView}
        mode="edit"
        modelOptions={modelOptionsQuery.data}
        open={taskEditOpen}
        submitting={updateTaskMutation.isPending}
        onOpenChange={setTaskEditOpen}
        onSubmit={(input) => updateSelectedTask(input)}
      />
    </AppFrame>
  );
}

function applyLiveTaskState(
  task: NonNullable<ReturnType<typeof useControlPlaneTaskDetail>['task']>,
  live: ReturnType<typeof useControlPlaneHeartbeatEvents>['liveTasks'][string] | undefined,
) {
  if (!live) {
    return task;
  }

  return {
    ...task,
    state: {
      ...task.state,
      status: live.status,
      progress: live.progress,
      updatedAt: live.updatedAt,
      runId: live.runId ?? task.state.runId,
    },
  };
}
