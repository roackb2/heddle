import type { ControlPlaneState } from '@web/api/client';
import type { AppSurfaceId } from '@web/layout/types';
import { SessionListSection } from './SessionListSection';
import { TaskListSection } from './TaskListSection';

interface SidebarContentRegionProps {
  ariaLabel: string;
  activeSurfaceId: AppSurfaceId;
  selectedSessionId?: string;
  selectedTaskId?: string;
  sessionListTitle: string;
  taskListTitle: string;
  sessions: ControlPlaneState['sessions'];
  tasks: ControlPlaneState['heartbeat']['tasks'];
  onCreateSession: () => Promise<void>;
  onCreateTask: () => void;
  onSelectSession: (sessionId: string) => void;
  onSelectTask: (taskId: string) => void;
}

// SidebarContentRegion owns the scrollable content area below primary
// navigation. Lists use the same shapes as their tRPC-backed views.
export function SidebarContentRegion({
  ariaLabel,
  activeSurfaceId,
  selectedSessionId,
  selectedTaskId,
  sessionListTitle,
  taskListTitle,
  sessions,
  tasks,
  onCreateSession,
  onCreateTask,
  onSelectSession,
  onSelectTask,
}: SidebarContentRegionProps) {
  return (
    <div
      className="v2-panel-divider v2-panel-surface flex min-h-0 flex-1 flex-col border-t"
      aria-label={ariaLabel}
    >
      {activeSurfaceId === 'tasks' ? (
        <TaskListSection
          selectedTaskId={selectedTaskId}
          tasks={tasks}
          title={taskListTitle}
          onCreateTask={onCreateTask}
          onSelectTask={onSelectTask}
        />
      ) : (
        <SessionListSection
          selectedSessionId={selectedSessionId}
          sessions={sessions}
          title={sessionListTitle}
          onCreateSession={onCreateSession}
          onSelectSession={onSelectSession}
        />
      )}
    </div>
  );
}
