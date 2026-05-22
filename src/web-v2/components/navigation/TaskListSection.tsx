import type { ControlPlaneState } from '@web/api/client';

interface TaskListSectionProps {
  tasks: ControlPlaneState['heartbeat']['tasks'];
  title: string;
}

// TaskListSection renders heartbeat task views using the same shape exposed by
// the control-plane state tRPC endpoint.
export function TaskListSection({ tasks, title }: TaskListSectionProps) {
  return (
    <section className="flex min-h-0 flex-1 flex-col gap-1 px-2 py-2" aria-label={title}>
      <div
        className="v2-type-section-label px-2 pb-1 tracking-normal text-muted-foreground"
      >
        {title}
      </div>
      <div className="v2-scrollbar-hidden flex min-h-0 flex-1 flex-col gap-0.5 overflow-auto">
        {tasks.map((task) => (
          <button
            key={task.taskId}
            type="button"
            className="group flex w-full min-w-0 flex-col rounded-md px-2 py-1.5 text-left outline-none transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-1 focus-visible:ring-sidebar-ring"
          >
            <span className="flex w-full min-w-0 items-center gap-2">
              <span className="v2-type-nav-primary truncate text-sidebar-foreground group-hover:text-sidebar-accent-foreground">
                {task.name ?? task.task}
              </span>
              <span className="v2-type-caption ml-auto shrink-0 text-muted-foreground">
                {task.status}
              </span>
            </span>
            <span className="v2-type-nav-secondary w-full truncate text-muted-foreground">
              {task.summary ?? task.progress ?? task.task}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
