import { skipToken } from '@tanstack/react-query';
import { trpcReact, type ControlPlaneHeartbeatRun } from '@web/api/client';

export function useControlPlaneTaskRunDetail(
  taskId: string | undefined,
  runId: string | undefined,
): {
  run: ControlPlaneHeartbeatRun['run'];
  loading: boolean;
  error?: string;
} {
  const runQuery = trpcReact.controlPlane.heartbeatRun.useQuery(
    taskId && runId ? { taskId, runId } : skipToken,
    {
      enabled: Boolean(taskId && runId),
    },
  );

  return {
    run: runQuery.data?.run ?? null,
    loading: runQuery.isLoading || runQuery.isFetching,
    error: runQuery.error instanceof Error ? runQuery.error.message : undefined,
  };
}
