import type { ControlPlaneState } from '@web/api/client';
import { Button } from '@web/components/ui/button';
import { useI18n } from '@web/i18n';
import { cn } from '@web/lib/utils';
import { Plus } from 'lucide-react';

interface TaskListSectionProps {
  selectedTaskId?: string;
  tasks: ControlPlaneState['heartbeat']['tasks'];
  title: string;
  onCreateTask: () => void;
  onSelectTask: (taskId: string) => void;
}

// TaskListSection renders heartbeat task views using the same shape exposed by
// the control-plane state tRPC endpoint.
export function TaskListSection({
  selectedTaskId,
  tasks,
  title,
  onCreateTask,
  onSelectTask,
}: TaskListSectionProps) {
  const { t } = useI18n();

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-1 px-2 py-2" aria-label={title}>
      <Button
        type="button"
        variant="ghost"
        size="none"
        className="v2-sidebar-action"
        onClick={onCreateTask}
      >
        <Plus aria-hidden="true" />
        <span>{t('navigation.newTask')}</span>
      </Button>
      <div
        className="v2-type-section-label px-2 pt-2 pb-1 tracking-normal text-muted-foreground"
      >
        {title}
      </div>
      <div className="v2-scrollbar-hidden flex min-h-0 flex-1 flex-col gap-0.5 overflow-auto">
        {tasks.map((task) => (
          <button
            key={task.taskId}
            type="button"
            aria-current={task.taskId === selectedTaskId}
            className={cn(
              'group flex w-full min-w-0 flex-col rounded-md px-2 py-1.5 text-left outline-none transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-1 focus-visible:ring-sidebar-ring',
              task.taskId === selectedTaskId && 'bg-sidebar-accent text-sidebar-accent-foreground',
            )}
            onClick={() => onSelectTask(task.taskId)}
          >
            <span className="flex w-full min-w-0 items-center gap-2">
              <span className="v2-type-nav-primary truncate text-sidebar-foreground group-hover:text-sidebar-accent-foreground">
                {task.name ?? task.task}
              </span>
              <span className="v2-type-caption ml-auto shrink-0 text-muted-foreground">
                {task.state.status === 'blocked' || task.enabled ? task.state.status : t('tasks.paused')}
              </span>
            </span>
            <span className="v2-type-nav-secondary w-full truncate text-muted-foreground">
              {task.state.result?.summary ?? task.state.progress ?? task.task}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
