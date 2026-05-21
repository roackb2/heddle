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
        className="px-2 pb-1 text-[0.6875rem] font-medium uppercase tracking-normal text-muted-foreground"
      >
        {title}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-auto">
        {tasks.map((task) => (
          <button
            key={task.taskId}
            type="button"
            className="group flex w-full min-w-0 flex-col rounded-md px-2 py-1.5 text-left outline-none transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-1 focus-visible:ring-sidebar-ring"
          >
            <span className="flex w-full min-w-0 items-center gap-2">
              <span className="truncate text-sm font-medium leading-5 text-sidebar-foreground group-hover:text-sidebar-accent-foreground">
                {task.name ?? task.task}
              </span>
              <span className="ml-auto shrink-0 text-[0.6875rem] leading-4 text-muted-foreground">
                {task.status}
              </span>
            </span>
            <span className="w-full truncate text-xs leading-4 text-muted-foreground">
              {task.summary ?? task.progress ?? task.task}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
