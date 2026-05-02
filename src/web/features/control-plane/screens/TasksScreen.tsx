import type { ControlPlaneState } from '../../../lib/api';
import { TasksDesktopLayout } from '../components/tasks-screen/TasksDesktopLayout';
import { useIsMobile } from '../hooks/useIsMobile';
import { MobileTasksScreen } from '../mobile/MobileTasksScreen';

export type TasksScreenProps = {
  tasks: ControlPlaneState['heartbeat']['tasks'];
  runs: ControlPlaneState['heartbeat']['runs'];
  selectedTask?: ControlPlaneState['heartbeat']['tasks'][number];
  selectedTaskId?: string;
  onSelectTask: (taskId: string) => void;
  selectedRun?: ControlPlaneState['heartbeat']['runs'][number];
  selectedRunId?: string;
  onSelectRun: (runId: string) => void;
  selectedTaskRuns: ControlPlaneState['heartbeat']['runs'];
  pendingTaskAction?: {
    taskId: string;
    action: 'enable' | 'disable' | 'trigger';
  };
  onEnableTask: (taskId: string) => Promise<void>;
  onDisableTask: (taskId: string) => Promise<void>;
  onTriggerTask: (taskId: string) => Promise<void>;
};

export function TasksScreen(props: TasksScreenProps) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return <MobileTasksScreen {...props} />;
  }

  return <TasksDesktopLayout {...props} />;
}
