import dayjs from 'dayjs';
import type { ControlPlaneHeartbeatTaskView } from '@web/api/client';
import type { useControlPlaneHeartbeatEvents } from './useControlPlaneHeartbeatEvents';

type LiveTaskState = ReturnType<typeof useControlPlaneHeartbeatEvents>['liveTasks'][string];

export function applyLiveTaskState(
  task: ControlPlaneHeartbeatTaskView,
  live: LiveTaskState | undefined,
) {
  if (!live || isStaleLiveTaskState(task, live)) {
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

function isStaleLiveTaskState(
  task: ControlPlaneHeartbeatTaskView,
  live: LiveTaskState,
) {
  const taskUpdatedAt = dayjs(task.state.updatedAt);
  const liveUpdatedAt = dayjs(live.updatedAt);
  return (
    live.status !== 'running' &&
    taskUpdatedAt.isValid() &&
    liveUpdatedAt.isValid() &&
    taskUpdatedAt.isAfter(liveUpdatedAt)
  );
}
