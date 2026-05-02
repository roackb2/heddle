import type { ControlPlaneState } from '../../../../lib/api';
import { useTaskDesktopView } from '../../hooks/tasks-screen/useTaskDesktopView';
import { RunsPanel } from './RunsPanel';
import { TaskDetailPanel } from './TaskDetailPanel';
import { TasksSidebar } from './TasksSidebar';

export function TasksDesktopLayout({
  tasks,
  runs,
  selectedTask,
  selectedTaskId,
  onSelectTask,
  selectedRun,
  selectedRunId,
  onSelectRun,
  selectedTaskRuns,
  pendingTaskAction,
  onEnableTask,
  onDisableTask,
  onTriggerTask,
}: {
  tasks: ControlPlaneState['heartbeat']['tasks'];
  runs: ControlPlaneState['heartbeat']['runs'];
  selectedTask?: ControlPlaneState['heartbeat']['tasks'][number];
  selectedTaskId?: string;
  onSelectTask: (taskId: string) => void;
  selectedRun?: ControlPlaneState['heartbeat']['runs'][number];
  selectedRunId?: string;
  onSelectRun: (runId: string) => void;
  selectedTaskRuns: ControlPlaneState['heartbeat']['runs'];
  pendingTaskAction?: { taskId: string; action: 'enable' | 'disable' | 'trigger' };
  onEnableTask: (taskId: string) => Promise<void>;
  onDisableTask: (taskId: string) => Promise<void>;
  onTriggerTask: (taskId: string) => Promise<void>;
}) {
  const { isTaskBusy, selectedTaskExecution } = useTaskDesktopView({ selectedTask, pendingTaskAction });

  return (
    <section className="workspace-shell tasks-shell">
      <TasksSidebar tasks={tasks} selectedTaskId={selectedTaskId} onSelectTask={onSelectTask} />
      <TaskDetailPanel
        selectedTask={selectedTask}
        pendingTaskAction={pendingTaskAction}
        isTaskBusy={isTaskBusy}
        selectedTaskExecution={selectedTaskExecution}
        onEnableTask={onEnableTask}
        onDisableTask={onDisableTask}
        onTriggerTask={onTriggerTask}
      />
      <RunsPanel
        runs={runs}
        selectedTask={selectedTask}
        selectedTaskRuns={selectedTaskRuns}
        selectedRun={selectedRun}
        selectedRunId={selectedRunId}
        onSelectRun={onSelectRun}
      />
    </section>
  );
}
