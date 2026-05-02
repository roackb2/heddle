import type { ControlPlaneState } from '../../../../lib/api';
import { describeHeartbeatExecution } from '../../utils';

export function useTaskDesktopView({
  selectedTask,
  pendingTaskAction,
}: {
  selectedTask?: ControlPlaneState['heartbeat']['tasks'][number];
  pendingTaskAction?: {
    taskId: string;
    action: 'enable' | 'disable' | 'trigger';
  };
}) {
  return {
    isTaskBusy: Boolean(selectedTask && pendingTaskAction && pendingTaskAction.taskId === selectedTask.taskId),
    selectedTaskExecution: selectedTask ? describeHeartbeatExecution(selectedTask) : undefined,
  };
}
