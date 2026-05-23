import { skipToken } from '@tanstack/react-query';
import { useMemo } from 'react';
import { trpcReact, type ControlPlaneHeartbeatRunView, type ControlPlaneHeartbeatTask } from '@web/api/client';

type ControlPlaneTaskDetailState = {
  task: ControlPlaneHeartbeatTask['task'] | undefined;
  runs: ControlPlaneHeartbeatTask['runs'];
  selectedRun: ControlPlaneHeartbeatRunView | undefined;
  loading: boolean;
  error?: string;
};

export function useControlPlaneTaskDetail(
  taskId: string | undefined,
  selectedRunId: string | undefined,
): ControlPlaneTaskDetailState {
  const taskQuery = trpcReact.controlPlane.heartbeatTask.useQuery(
    taskId ? { taskId, runLimit: 50 } : skipToken,
    {
      enabled: Boolean(taskId),
    },
  );

  return useMemo(() => {
    const runs = taskQuery.data?.runs ?? [];
    return {
      task: taskQuery.data?.task,
      runs,
      selectedRun: resolveSelectedRun(runs, selectedRunId),
      loading: taskQuery.isLoading || taskQuery.isFetching,
      error: taskQuery.error instanceof Error ? taskQuery.error.message : undefined,
    };
  }, [selectedRunId, taskQuery.data?.runs, taskQuery.data?.task, taskQuery.error, taskQuery.isFetching, taskQuery.isLoading]);
}

function resolveSelectedRun(
  runs: ControlPlaneHeartbeatTask['runs'],
  selectedRunId: string | undefined,
): ControlPlaneHeartbeatRunView | undefined {
  if (!selectedRunId) {
    return runs[0];
  }

  return runs.find((run) => run.runId === selectedRunId || run.id === selectedRunId) ?? runs[0];
}
