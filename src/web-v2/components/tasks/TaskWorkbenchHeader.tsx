import type { ControlPlaneHeartbeatTaskView } from '@web/api/client';
import { formatTaskInterval, formatTaskTimestamp, taskDisplayName } from './task-format';
import { TaskStatusPill } from './TaskStatusPill';

interface TaskWorkbenchHeaderProps {
  task: ControlPlaneHeartbeatTaskView;
}

export function TaskWorkbenchHeader({ task }: TaskWorkbenchHeaderProps) {
  return (
    <section className="v2-task-header">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <h2 className="v2-type-body-strong min-w-0 truncate text-balance text-foreground">{taskDisplayName(task)}</h2>
        <TaskStatusPill status={task.status} />
        <span className="v2-type-caption rounded-sm border border-border bg-muted/20 px-1.5 py-0.5 text-muted-foreground">
          {task.enabled ? 'enabled' : 'paused'}
        </span>
      </div>
      <div className="v2-type-caption mt-2 flex min-w-0 flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
        <span>{formatTaskInterval(task.intervalMs)}</span>
        <span>last {formatTaskTimestamp(task.lastRunAt)}</span>
        <span>next {formatTaskTimestamp(task.nextRunAt)}</span>
      </div>
      <p className="v2-type-panel-subtitle mt-4 text-pretty text-muted-foreground">{task.task}</p>
    </section>
  );
}
