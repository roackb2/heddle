import { useState } from 'react';
import { trpcReact, type ControlPlaneHeartbeatTaskView } from '@web/api/client';
import { LIVE_TASK_RUN_ID, type TaskCreateInput } from '@web/components/tasks';
import type { useControlPlaneHeartbeatEvents } from './useControlPlaneHeartbeatEvents';
import type { useWorkbenchNavigation } from '../useWorkbenchNavigation';

type WorkbenchNavigation = ReturnType<typeof useWorkbenchNavigation>;
type HeartbeatEvents = ReturnType<typeof useControlPlaneHeartbeatEvents>;

export function useControlPlaneTaskActions({
  navigation,
  selectedTask,
  sidebarTasks,
  taskEvents,
}: {
  navigation: WorkbenchNavigation;
  selectedTask: ControlPlaneHeartbeatTaskView | undefined;
  sidebarTasks: ControlPlaneHeartbeatTaskView[];
  taskEvents: HeartbeatEvents;
}) {
  const utils = trpcReact.useUtils();
  const modelOptionsQuery = trpcReact.controlPlane.modelOptions.useQuery();
  const createTaskMutation = trpcReact.controlPlane.heartbeatTaskCreate.useMutation();
  const updateTaskMutation = trpcReact.controlPlane.heartbeatTaskUpdate.useMutation();
  const deleteTaskMutation = trpcReact.controlPlane.heartbeatTaskDelete.useMutation();
  const resumeTaskMutation = trpcReact.controlPlane.heartbeatTaskResume.useMutation();
  const runTaskNowMutation = trpcReact.controlPlane.heartbeatTaskRunNow.useMutation();
  const [createOpen, setCreateOpen] = useState(false);
  const [createError, setCreateError] = useState<string | undefined>();
  const [editOpen, setEditOpen] = useState(false);
  const [editError, setEditError] = useState<string | undefined>();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | undefined>();

  async function createTask(input: TaskCreateInput, options: { runNow: boolean }) {
    setCreateError(undefined);
    try {
      const created = await createTaskMutation.mutateAsync(input);
      navigation.selectTask(created.task.taskId);
      await invalidateTaskViews(created.task.taskId);
      if (options.runNow) {
        taskEvents.markTaskRunQueued(created.task.taskId);
        await runTaskNowMutation.mutateAsync({ taskId: created.task.taskId });
      }
      setCreateOpen(false);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  async function updateSelectedTask(input: TaskCreateInput) {
    if (!navigation.selectedTaskId) {
      return;
    }

    setEditError(undefined);
    try {
      const updated = await updateTaskMutation.mutateAsync({
        taskId: navigation.selectedTaskId,
        ...input,
        model: input.model ?? null,
        maxSteps: input.maxSteps ?? null,
      });
      await invalidateTaskViews(updated.task.taskId);
      setEditOpen(false);
    } catch (error) {
      setEditError(error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  async function deleteSelectedTask() {
    if (!navigation.selectedTaskId) {
      return;
    }

    const taskId = navigation.selectedTaskId;
    setDeleteError(undefined);
    try {
      await deleteTaskMutation.mutateAsync({ taskId });
      setDeleteOpen(false);
      const nextTask = sidebarTasks.find((task) => task.taskId !== taskId);
      if (nextTask) {
        navigation.selectTask(nextTask.taskId, { replace: true });
      } else {
        navigation.selectSurface('tasks', { replace: true });
      }
      await invalidateTaskViews(taskId);
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  async function runSelectedTaskNow() {
    if (!navigation.selectedTaskId) {
      return;
    }

    const taskId = navigation.selectedTaskId;
    taskEvents.markTaskRunQueued(taskId);
    navigation.selectTaskRun(taskId, LIVE_TASK_RUN_ID, { replace: true });
    await runTaskNowMutation.mutateAsync({ taskId });
  }

  async function resumeSelectedTask() {
    if (!navigation.selectedTaskId) {
      return;
    }

    const taskId = navigation.selectedTaskId;
    taskEvents.markTaskRunQueued(taskId);
    navigation.selectTaskRun(taskId, LIVE_TASK_RUN_ID, { replace: true });
    await resumeTaskMutation.mutateAsync({ taskId });
    await invalidateTaskViews(taskId);
  }

  async function invalidateTaskViews(taskId: string) {
    await Promise.all([
      utils.controlPlane.heartbeatTasks.invalidate(),
      utils.controlPlane.heartbeatTask.invalidate({ taskId }),
      utils.controlPlane.state.invalidate(),
    ]);
  }

  return {
    createDialogProps: {
      error: createError,
      modelOptions: modelOptionsQuery.data,
      open: createOpen,
      submitting: createTaskMutation.isPending || runTaskNowMutation.isPending,
      onOpenChange: setCreateOpen,
      onSubmit: createTask,
    },
    deleteDialogProps: {
      error: deleteError,
      open: deleteOpen,
      submitting: deleteTaskMutation.isPending,
      task: selectedTask,
      onOpenChange: setDeleteOpen,
      onConfirm: deleteSelectedTask,
    },
    editDialogProps: {
      error: editError,
      initialTask: selectedTask,
      mode: 'edit' as const,
      modelOptions: modelOptionsQuery.data,
      open: editOpen,
      submitting: updateTaskMutation.isPending,
      onOpenChange: setEditOpen,
      onSubmit: updateSelectedTask,
    },
    openCreateDialog: () => {
      setCreateError(undefined);
      setCreateOpen(true);
    },
    openDeleteDialog: () => {
      setDeleteError(undefined);
      setDeleteOpen(true);
    },
    openEditDialog: () => {
      setEditError(undefined);
      setEditOpen(true);
    },
    resumeSelectedTask,
    runSelectedTaskNow,
    taskSubmitting: runTaskNowMutation.isPending || resumeTaskMutation.isPending || selectedTask?.state.status === 'running',
  };
}
