import type { ControlPlaneHeartbeatRunView, ControlPlaneHeartbeatTask } from '@web/api/client';
import { TaskRunList, TaskWorkbenchHeader } from '@web/components/tasks';

interface TasksWorkbenchViewProps {
  task: ControlPlaneHeartbeatTask['task'] | undefined;
  runs: ControlPlaneHeartbeatRunView[];
  selectedRunId?: string;
  loading: boolean;
  error?: string;
  running: boolean;
  onEditTask: () => void;
  onDeleteTask: () => void;
  onRunNow: () => Promise<void>;
  onResumeTask: () => Promise<void>;
  onSetTaskEnabled: (enabled: boolean) => Promise<void>;
  onSelectRun: (runId: string) => void;
}

export function TasksWorkbenchView({
  task,
  runs,
  selectedRunId,
  loading,
  error,
  running,
  onEditTask,
  onDeleteTask,
  onRunNow,
  onResumeTask,
  onSetTaskEnabled,
  onSelectRun,
}: TasksWorkbenchViewProps) {
  if (loading) {
    return <TaskWorkbenchEmpty title="Loading task" body="Reading task schedule and run history." />;
  }

  if (error) {
    return <TaskWorkbenchEmpty title="Task unavailable" body={error} />;
  }

  if (!task) {
    return <TaskWorkbenchEmpty title="Select a task" body="Choose a task to inspect its schedule and run history." />;
  }

  return (
    <div className="v2-scrollbar-hidden h-full min-w-0 overflow-auto">
      <div className="v2-task-workbench mx-auto flex w-full max-w-4xl flex-col gap-5 px-8 py-8">
        <TaskWorkbenchHeader
          task={task}
          running={running}
          onEdit={onEditTask}
          onDelete={onDeleteTask}
          onRunNow={onRunNow}
          onResume={onResumeTask}
          onSetEnabled={onSetTaskEnabled}
        />
        <section className="min-w-0">
          <h2 className="v2-type-section-label mb-2 text-muted-foreground">Runs</h2>
          <TaskRunList liveTask={task} runs={runs} selectedRunId={selectedRunId} onSelectRun={onSelectRun} />
        </section>
      </div>
    </div>
  );
}

function TaskWorkbenchEmpty({
  title,
  body,
}: {
  title: string;
  body: string;
}) {
  return (
    <div className="flex h-full min-h-0 items-center justify-center px-6">
      <div className="max-w-sm text-center">
        <p className="v2-type-body-strong text-foreground">{title}</p>
        <p className="v2-type-panel-subtitle mt-1 text-pretty text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}
