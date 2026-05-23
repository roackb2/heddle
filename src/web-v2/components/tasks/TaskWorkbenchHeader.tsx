import { Play } from 'lucide-react';
import type { ControlPlaneHeartbeatTaskView } from '@web/api/client';
import { Button } from '@web/components/ui/button';
import { useI18n } from '@web/i18n';
import { formatTaskInterval, formatTaskTimestamp, taskDisplayName } from './task-format';
import { TaskStatusPill } from './TaskStatusPill';

interface TaskWorkbenchHeaderProps {
  running: boolean;
  task: ControlPlaneHeartbeatTaskView;
  onRunNow: () => Promise<void>;
}

export function TaskWorkbenchHeader({ running, task, onRunNow }: TaskWorkbenchHeaderProps) {
  const { t } = useI18n();
  const runDisabled = running || !task.enabled || task.status === 'running';

  return (
    <section className="v2-task-header">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
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
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="shrink-0"
          disabled={runDisabled}
          onClick={() => void onRunNow()}
        >
          <Play aria-hidden="true" />
          {t('tasks.runNow')}
        </Button>
      </div>
      <p className="v2-type-panel-subtitle mt-4 text-pretty text-muted-foreground">{task.task}</p>
    </section>
  );
}
