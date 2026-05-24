import { Pencil, Play, RotateCcw, Trash2 } from 'lucide-react';
import type { ControlPlaneHeartbeatTaskView } from '@web/api/client';
import { Button } from '@web/components/ui/button';
import { useI18n } from '@web/i18n';
import { formatTaskInterval, formatTaskTimestamp, taskDisplayName } from './task-format';
import { TaskStatusPill } from './TaskStatusPill';

interface TaskWorkbenchHeaderProps {
  running: boolean;
  task: ControlPlaneHeartbeatTaskView;
  onEdit: () => void;
  onDelete: () => void;
  onRunNow: () => Promise<void>;
  onResume: () => Promise<void>;
}

export function TaskWorkbenchHeader({ running, task, onEdit, onDelete, onRunNow, onResume }: TaskWorkbenchHeaderProps) {
  const { t } = useI18n();
  const runDisabled = running || !task.enabled || task.state.status === 'running';
  const blocked = task.state.status === 'blocked';

  return (
    <section className="v2-task-header">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h2 className="v2-type-body-strong min-w-0 truncate text-balance text-foreground">{taskDisplayName(task)}</h2>
            <TaskStatusPill status={task.state.status} />
            <span className="v2-type-caption rounded-sm border border-border bg-muted/20 px-1.5 py-0.5 text-muted-foreground">
              {task.enabled ? 'enabled' : 'paused'}
            </span>
          </div>
          <div className="v2-type-caption mt-2 flex min-w-0 flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
            <span>{formatTaskInterval(task.schedule.intervalMs)}</span>
            <span>last {formatTaskTimestamp(task.state.runAt)}</span>
            <span>next {formatTaskTimestamp(task.schedule.nextRunAt)}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t('tasks.edit.open')}
            onClick={onEdit}
          >
            <Pencil aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive focus-visible:ring-destructive/50 disabled:text-muted-foreground"
            disabled={task.state.status === 'running'}
            aria-label={t('tasks.delete.open')}
            onClick={onDelete}
          >
            <Trash2 aria-hidden="true" />
          </Button>
          {blocked ?
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={running}
              onClick={() => void onResume()}
            >
              <RotateCcw aria-hidden="true" />
              {t('tasks.resume')}
            </Button>
          : <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={runDisabled}
              onClick={() => void onRunNow()}
            >
              <Play aria-hidden="true" />
              {t('tasks.runNow')}
            </Button>}
        </div>
      </div>
      <p className="v2-type-panel-subtitle mt-4 text-pretty text-muted-foreground">{task.task}</p>
    </section>
  );
}
