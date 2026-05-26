import { LIVE_TASK_RUN_ID } from '@web/components/tasks';
import type { useControlPlaneHeartbeatEvents } from './useControlPlaneHeartbeatEvents';
import { useControlPlaneTaskDetail } from './useControlPlaneTaskDetail';
import { useControlPlaneTaskRunDetail } from './useControlPlaneTaskRunDetail';
import { applyLiveTaskState } from './useControlPlaneTaskLiveState';
import type { useWorkbenchNavigation } from '../useWorkbenchNavigation';

type WorkbenchNavigation = ReturnType<typeof useWorkbenchNavigation>;
type HeartbeatEvents = ReturnType<typeof useControlPlaneHeartbeatEvents>;

export function useControlPlaneTaskSelection({
  navigation,
  taskEvents,
  workspaceId,
}: {
  navigation: WorkbenchNavigation;
  taskEvents: HeartbeatEvents;
  workspaceId?: string;
}) {
  const detail = useControlPlaneTaskDetail(workspaceId, navigation.selectedTaskId, navigation.selectedTaskRunId);
  const task = detail.task ? applyLiveTaskState(detail.task, taskEvents.liveTasks[detail.task.taskId]) : undefined;
  const selectedRunId = navigation.selectedTaskRunId ?? detail.selectedRun?.runId;
  const runDetail = useControlPlaneTaskRunDetail(
    workspaceId,
    navigation.selectedTaskId,
    selectedRunId === LIVE_TASK_RUN_ID ? undefined : selectedRunId,
  );

  function selectRun(runId: string) {
    if (!navigation.selectedTaskId) {
      return;
    }

    navigation.selectTaskRun(navigation.selectedTaskId, runId);
  }

  return {
    ...detail,
    task,
    selectedRunId,
    runDetail,
    selectRun,
  };
}
