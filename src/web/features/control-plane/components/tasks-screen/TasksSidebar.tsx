import type { ControlPlaneState } from '../../../../lib/api';
import { EmptyState, WorkspaceSectionHeader } from '../common';
import { TaskListButton } from '../lists';

export function TasksSidebar({
  tasks,
  selectedTaskId,
  onSelectTask,
}: {
  tasks: ControlPlaneState['heartbeat']['tasks'];
  selectedTaskId?: string;
  onSelectTask: (taskId: string) => void;
}) {
  return (
    <aside className="workspace-sidebar">
      <WorkspaceSectionHeader
        title="Tasks"
        subtitle={`${tasks.length} durable task${tasks.length === 1 ? '' : 's'}`}
      />
      <div className="sidebar-scroll">
        {tasks.length ?
          tasks.map((task) => (
            <TaskListButton
              key={task.taskId}
              task={task}
              active={task.taskId === selectedTaskId}
              onClick={() => onSelectTask(task.taskId)}
            />
          ))
        : <EmptyState title="No tasks" body="Add a heartbeat task in the CLI, then manage it from this view." />}
      </div>
    </aside>
  );
}
