import { useEffect, useState, type ReactNode } from 'react';

import type { ControlPlaneState } from '../../../lib/api';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { describeHeartbeatExecution, formatDate, formatInterval, formatUsage } from '../utils';

type HeartbeatTask = ControlPlaneState['heartbeat']['tasks'][number];
type HeartbeatRun = ControlPlaneState['heartbeat']['runs'][number];

type MobileTasksScreenProps = {
  tasks: HeartbeatTask[];
  selectedTask?: HeartbeatTask;
  selectedTaskId?: string;
  onSelectTask: (taskId: string) => void;
  selectedRun?: HeartbeatRun;
  selectedRunId?: string;
  onSelectRun: (runId: string) => void;
  selectedTaskRuns: HeartbeatRun[];
  pendingTaskAction?: {
    taskId: string;
    action: 'enable' | 'disable' | 'trigger';
  };
  onEnableTask: (taskId: string) => Promise<void>;
  onDisableTask: (taskId: string) => Promise<void>;
  onTriggerTask: (taskId: string) => Promise<void>;
};

type MobileTaskView = 'list' | 'detail' | 'runs';

export function MobileTasksScreen({
  tasks,
  selectedTask,
  selectedTaskId,
  onSelectTask,
  selectedRun,
  selectedRunId,
  onSelectRun,
  selectedTaskRuns,
  pendingTaskAction,
  onEnableTask,
  onDisableTask,
  onTriggerTask,
}: MobileTasksScreenProps) {
  const [view, setView] = useState<MobileTaskView>(selectedTaskId ? 'detail' : 'list');
  const isTaskBusy = Boolean(selectedTask && pendingTaskAction && pendingTaskAction.taskId === selectedTask.taskId);
  const selectedTaskExecution = selectedTask ? describeHeartbeatExecution(selectedTask) : undefined;

  useEffect(() => {
    if (!selectedTaskId) {
      setView('list');
      return;
    }

    setView((current) => current === 'list' ? 'detail' : current);
  }, [selectedTaskId]);

  if (view === 'list') {
    return (
      <section className="flex h-full min-h-0 flex-col bg-background">
        <header className="shrink-0 border-b border-border bg-card px-3 py-2">
          <p className="m-0 text-sm font-semibold text-foreground">Tasks</p>
          <p className="m-0 text-xs text-muted-foreground">{tasks.length} durable task{tasks.length === 1 ? '' : 's'}</p>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {tasks.length ?
            <div className="space-y-2">
              {tasks.map((task) => {
                const execution = describeHeartbeatExecution(task);
                return (
                <button
                  key={task.taskId}
                  type="button"
                  className={`w-full rounded-md border px-3 py-3 text-left ${task.taskId === selectedTaskId ? 'border-primary bg-primary/5' : 'border-border bg-card'}`}
                  onClick={() => {
                    onSelectTask(task.taskId);
                    setView('detail');
                  }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="m-0 line-clamp-2 text-sm font-semibold text-foreground">{task.name || task.taskId}</p>
                    <p className="m-0 shrink-0 text-[11px] text-muted-foreground">{formatDate(task.nextRunAt)}</p>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    <Badge variant={task.enabled ? 'secondary' : 'outline'}>{task.enabled ? 'enabled' : 'disabled'}</Badge>
                    <Badge variant="outline">{execution.label}</Badge>
                    {task.decision ? <Badge variant="outline">{task.decision}</Badge> : null}
                  </div>
                  <p className="m-0 mt-2 text-xs text-muted-foreground">{task.task}</p>
                </button>
                );
              })}
            </div>
          : <MobileEmptyState title="No tasks" body="Add a heartbeat task in the CLI, then manage it from here." />}
        </div>
      </section>
    );
  }

  if (view === 'runs') {
    return (
      <section className="flex h-full min-h-0 flex-col bg-background">
        <header className="shrink-0 border-b border-border bg-card px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={() => setView('detail')}>
              ← Task
            </Button>
            <p className="m-0 text-xs text-muted-foreground">Runs</p>
          </div>
        </header>

        <nav className="shrink-0 border-b border-border bg-card px-3 py-2">
          <div className="grid grid-cols-2 rounded-md bg-muted p-1">
            <TabButton active={false} onClick={() => setView('detail')}>Summary</TabButton>
            <TabButton active>Runs</TabButton>
          </div>
        </nav>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          <div className="space-y-3">
            <MobileCard title="History">
              {selectedTaskRuns.length ?
                <div className="space-y-2">
                  {selectedTaskRuns.map((run) => (
                    <button
                      key={run.id}
                      type="button"
                      className={`w-full rounded-md border px-2 py-2 text-left ${run.id === selectedRunId ? 'border-primary bg-primary/5' : 'border-border bg-background'}`}
                      onClick={() => onSelectRun(run.id)}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="m-0 truncate text-xs font-medium text-foreground">{run.id}</p>
                        <p className="m-0 shrink-0 text-[11px] text-muted-foreground">{formatDate(run.createdAt)}</p>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        <Badge variant="outline">{run.status}</Badge>
                        <Badge variant="outline">{run.decision}</Badge>
                        <Badge variant="outline">{run.outcome}</Badge>
                      </div>
                    </button>
                  ))}
                </div>
              : <MobileEmptyState title="No runs" body="Run-once and scheduled executions appear here." />}
            </MobileCard>

            <MobileCard title="Run detail">
              {selectedRun ?
                <div className="space-y-2 text-xs">
                  <p className="m-0 text-sm font-semibold text-foreground">{selectedRun.id}</p>
                  <p className="m-0 text-muted-foreground">{selectedRun.summary}</p>
                  <SummaryRow label="created" value={formatDate(selectedRun.createdAt)} />
                  <SummaryRow label="task" value={selectedRun.taskId} />
                  <SummaryRow label="usage" value={formatUsage(selectedRun.usage) ?? 'none'} />
                  <SummaryRow label="checkpoint" value={selectedRun.loadedCheckpoint ? 'loaded' : 'fresh'} />
                  {selectedRun.progress ? <SummaryRow label="progress" value={selectedRun.progress} /> : null}
                </div>
              : <MobileEmptyState title="No run selected" body="Select a run to inspect the latest heartbeat result." />}
            </MobileCard>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="flex h-full min-h-0 flex-col bg-background">
      <header className="shrink-0 border-b border-border bg-card px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={() => setView('list')}>
            ← Tasks
          </Button>
          <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={() => setView('runs')} disabled={!selectedTaskRuns.length}>
            Runs
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {selectedTask ?
          <div className="space-y-3">
            <MobileCard title={selectedTask.name || selectedTask.taskId}>
              <div className="flex flex-wrap gap-1">
                <Badge variant={selectedTask.enabled ? 'secondary' : 'outline'}>{selectedTask.enabled ? 'enabled' : 'disabled'}</Badge>
                <Badge variant={selectedTaskExecution?.tone === 'good' ? 'secondary' : 'outline'}>{selectedTaskExecution?.label ?? selectedTask.status}</Badge>
                {selectedTask.decision ? <Badge variant="outline">{selectedTask.decision}</Badge> : null}
              </div>
              <p className="m-0 mt-2 text-xs text-muted-foreground">{selectedTask.taskId}</p>
              <p className="m-0 mt-2 text-sm text-foreground">{selectedTask.task}</p>
              <p className="m-0 mt-2 text-xs text-muted-foreground">{selectedTaskExecution?.detail}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={isTaskBusy || !selectedTask.enabled}
                  onClick={() => {
                    void onTriggerTask(selectedTask.taskId);
                  }}
                >
                  {isTaskBusy && pendingTaskAction?.action === 'trigger' ? 'Triggering…' : 'Run now'}
                </Button>
                {selectedTask.enabled ?
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={isTaskBusy}
                    onClick={() => {
                      void onDisableTask(selectedTask.taskId);
                    }}
                  >
                    {isTaskBusy && pendingTaskAction?.action === 'disable' ? 'Pausing…' : 'Pause task'}
                  </Button>
                : <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={isTaskBusy}
                    onClick={() => {
                      void onEnableTask(selectedTask.taskId);
                    }}
                  >
                    {isTaskBusy && pendingTaskAction?.action === 'enable' ? 'Resuming…' : 'Resume task'}
                  </Button>
                }
              </div>
            </MobileCard>

            <MobileCard title="Runtime status">
              <SummaryRow label="execution" value={selectedTaskExecution?.label ?? selectedTask.status} />
              <SummaryRow label="model" value={selectedTask.model ?? 'unset'} />
              <SummaryRow label="interval" value={formatInterval(selectedTask.intervalMs)} />
              <SummaryRow label="last run" value={formatDate(selectedTask.lastRunAt)} />
              <SummaryRow label="next run" value={formatDate(selectedTask.nextRunAt)} />
              <SummaryRow label="checkpoint" value={selectedTask.loadedCheckpoint ? 'loaded' : selectedTask.resumable ? 'resumable' : 'none'} />
              <SummaryRow label="usage" value={formatUsage(selectedTask.usage) ?? 'none'} />
            </MobileCard>

            {selectedTask.summary ?
              <MobileCard title="Latest summary">
                <p className="m-0 text-sm text-foreground">{selectedTask.summary}</p>
              </MobileCard>
            : null}

            {selectedTask.progress ?
              <MobileCard title="Progress">
                <p className="m-0 text-sm text-foreground">{selectedTask.progress}</p>
              </MobileCard>
            : null}

            {selectedTask.error ?
              <MobileCard title="Error">
                <p className="m-0 text-sm text-destructive">{selectedTask.error}</p>
              </MobileCard>
            : null}
          </div>
        : <MobileEmptyState title="No task selected" body="Choose a task to inspect its durable prompt and latest run state." />}
      </div>
    </section>
  );
}

function MobileCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-md border border-border bg-card px-3 py-3">
      <p className="m-0 text-sm font-semibold text-foreground">{title}</p>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[92px_minmax(0,1fr)] gap-2 text-xs">
      <span className="truncate text-muted-foreground">{label}</span>
      <span className="break-words text-foreground">{value}</span>
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick?: () => void; children: string }) {
  return (
    <button
      type="button"
      className={`h-8 rounded-md text-xs font-medium ${active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground'}`}
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
    >
      {children}
    </button>
  );
}

function MobileEmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-md border border-border bg-card px-3 py-3">
      <p className="m-0 text-sm font-semibold text-foreground">{title}</p>
      <p className="m-0 mt-1 text-xs text-muted-foreground">{body}</p>
    </div>
  );
}
