import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  disableHeartbeatTask,
  enableHeartbeatTask,
  triggerHeartbeatTask,
  type HeartbeatTaskMutationResult,
  type ControlPlaneState,
} from '../../../lib/api';
import type { ToastInput } from '../../../components/ui/use-toast';

export type HeartbeatTask = ControlPlaneState['heartbeat']['tasks'][number];
export type HeartbeatRun = ControlPlaneState['heartbeat']['runs'][number];

export type HeartbeatWorkspaceState = {
  selectedTaskId?: string;
  setSelectedTaskId: (taskId: string) => void;
  selectedTask?: HeartbeatTask;
  selectedTaskRuns: HeartbeatRun[];
  selectedRunId?: string;
  setSelectedRunId: (runId: string) => void;
  selectedRun?: HeartbeatRun;
  pendingTaskAction?: {
    taskId: string;
    action: 'enable' | 'disable' | 'trigger';
  };
  enableTask: (taskId: string) => Promise<void>;
  disableTask: (taskId: string) => Promise<void>;
  triggerTask: (taskId: string) => Promise<void>;
};

export function useHeartbeatWorkspace(
  tasks: ControlPlaneState['heartbeat']['tasks'] | undefined,
  runs: ControlPlaneState['heartbeat']['runs'] | undefined,
  notify?: (toast: ToastInput) => void,
  onHeartbeatChanged?: () => void,
): HeartbeatWorkspaceState {
  const [selectedTaskId, setSelectedTaskId] = useState<string | undefined>();
  const [selectedRunId, setSelectedRunId] = useState<string | undefined>();
  const [pendingTaskAction, setPendingTaskAction] = useState<HeartbeatWorkspaceState['pendingTaskAction']>();

  useEffect(() => {
    if (!tasks?.length) {
      setSelectedTaskId(undefined);
      return;
    }
    if (!selectedTaskId || !tasks.some((task) => task.taskId === selectedTaskId)) {
      setSelectedTaskId(tasks[0].taskId);
    }
  }, [selectedTaskId, tasks]);

  const selectedTaskRuns = useMemo(() => {
    if (!runs || !selectedTaskId) {
      return [];
    }
    return runs.filter((run) => run.taskId === selectedTaskId);
  }, [runs, selectedTaskId]);

  useEffect(() => {
    if (!selectedTaskRuns.length) {
      setSelectedRunId(undefined);
      return;
    }
    if (!selectedRunId || !selectedTaskRuns.some((run) => run.id === selectedRunId)) {
      setSelectedRunId(selectedTaskRuns[0].id);
    }
  }, [selectedRunId, selectedTaskRuns]);

  const selectedTask = useMemo(
    () => tasks?.find((task) => task.taskId === selectedTaskId),
    [selectedTaskId, tasks],
  );
  const selectedRun = useMemo(
    () => selectedTaskRuns.find((run) => run.id === selectedRunId) ?? selectedTaskRuns[0],
    [selectedRunId, selectedTaskRuns],
  );

  const mutateTask = useCallback(async (
    taskId: string,
    action: 'enable' | 'disable' | 'trigger',
    mutation: (id: string) => Promise<HeartbeatTaskMutationResult>,
  ) => {
    if (!taskId || pendingTaskAction) {
      return;
    }

    setPendingTaskAction({ taskId, action });
    try {
      const result = await mutation(taskId);
      onHeartbeatChanged?.();
      notify?.({
        title:
          action === 'enable' ? 'Task resumed'
          : action === 'disable' ? 'Task paused'
          : 'Task triggered',
        body:
          action === 'trigger' ?
            `${result.task.taskId} was queued for the next worker poll.`
          : `${result.task.taskId} is now ${result.task.enabled ? 'enabled' : 'disabled'}.`,
        tone: 'success',
      });
    } catch (error) {
      notify?.({
        title: 'Task action failed',
        body: error instanceof Error ? error.message : String(error),
        tone: 'error',
      });
    } finally {
      setPendingTaskAction(undefined);
    }
  }, [notify, onHeartbeatChanged, pendingTaskAction]);

  const enableTask = useCallback(async (taskId: string) => {
    await mutateTask(taskId, 'enable', enableHeartbeatTask);
  }, [mutateTask]);

  const disableTask = useCallback(async (taskId: string) => {
    await mutateTask(taskId, 'disable', disableHeartbeatTask);
  }, [mutateTask]);

  const triggerTask = useCallback(async (taskId: string) => {
    await mutateTask(taskId, 'trigger', triggerHeartbeatTask);
  }, [mutateTask]);

  return {
    selectedTaskId,
    setSelectedTaskId,
    selectedTask,
    selectedTaskRuns,
    selectedRunId,
    setSelectedRunId,
    selectedRun,
    pendingTaskAction,
    enableTask,
    disableTask,
    triggerTask,
  };
}
