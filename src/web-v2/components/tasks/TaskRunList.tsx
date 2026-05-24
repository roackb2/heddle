import type { ControlPlaneHeartbeatRunView, ControlPlaneHeartbeatTaskView } from '@web/api/client';
import { cn } from '@web/lib/utils';
import { formatTaskTimestamp, runDisplaySummary } from './task-format';

export const LIVE_TASK_RUN_ID = 'live';

interface TaskRunListProps {
  runs: ControlPlaneHeartbeatRunView[];
  liveTask?: ControlPlaneHeartbeatTaskView;
  selectedRunId?: string;
  onSelectRun: (runId: string) => void;
}

export function TaskRunList({
  runs,
  liveTask,
  selectedRunId,
  onSelectRun,
}: TaskRunListProps) {
  const showLiveRun = Boolean(liveTask && (liveTask.state.status === 'running' || liveTask.state.progress?.startsWith('Task queued')));

  if (runs.length === 0 && !showLiveRun) {
    return (
      <div className="v2-task-empty">
        <p className="v2-type-body-strong text-foreground">No runs yet</p>
        <p className="v2-type-panel-subtitle text-muted-foreground">This task has no recorded heartbeat runs.</p>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-1">
      {showLiveRun && liveTask ? (
        <TaskLiveRunListItem
          task={liveTask}
          selected={selectedRunId === LIVE_TASK_RUN_ID}
          onSelectRun={onSelectRun}
        />
      ) : null}
      {runs.map((run) => (
        <TaskRunListItem
          key={run.id}
          run={run}
          selected={run.runId === selectedRunId || run.id === selectedRunId}
          onSelectRun={onSelectRun}
        />
      ))}
    </div>
  );
}

function TaskLiveRunListItem({
  task,
  selected,
  onSelectRun,
}: {
  task: ControlPlaneHeartbeatTaskView;
  selected: boolean;
  onSelectRun: (runId: string) => void;
}) {
  return (
    <button
      type="button"
      aria-current={selected}
      className={cn(
        'v2-task-run-row min-w-0 bg-accent/40 text-left outline-none transition-colors hover:bg-accent/50 focus-visible:ring-1 focus-visible:ring-ring',
        selected && 'bg-accent/55',
      )}
      onClick={() => onSelectRun(LIVE_TASK_RUN_ID)}
    >
      <span className="flex min-w-0 items-center gap-2">
        <span className="v2-type-nav-primary truncate text-foreground">
          {task.state.runAt ? formatTaskTimestamp(task.state.runAt) : 'Running now'}
        </span>
        <span className="v2-type-caption ml-auto shrink-0 text-muted-foreground">live</span>
      </span>
      <span className="mt-1 flex min-w-0 items-center gap-2">
        <span className="v2-type-caption shrink-0 rounded-sm border border-border bg-muted/20 px-1.5 py-0.5 text-muted-foreground">
          running
        </span>
        <span className="v2-type-nav-secondary truncate text-muted-foreground">
          {task.state.progress ?? 'Heartbeat runner is working...'}
        </span>
      </span>
    </button>
  );
}

function TaskRunListItem({
  run,
  selected,
  onSelectRun,
}: {
  run: ControlPlaneHeartbeatRunView;
  selected: boolean;
  onSelectRun: (runId: string) => void;
}) {
  return (
    <button
      type="button"
      aria-current={selected}
      className={cn(
        'v2-task-run-row group min-w-0 text-left outline-none transition-colors hover:bg-accent/45 focus-visible:ring-1 focus-visible:ring-ring',
        selected && 'bg-accent/55',
      )}
      onClick={() => onSelectRun(run.runId)}
    >
      <span className="flex min-w-0 items-center gap-2">
        <span className="v2-type-nav-primary truncate text-foreground">{formatTaskTimestamp(run.createdAt)}</span>
      </span>
      <span className="mt-1 flex min-w-0 items-center gap-2">
        <span className="v2-type-caption shrink-0 rounded-sm border border-border bg-muted/20 px-1.5 py-0.5 text-muted-foreground">
          {run.result.decision}
        </span>
        <span className="v2-type-nav-secondary truncate text-muted-foreground">{runDisplaySummary(run)}</span>
      </span>
    </button>
  );
}
