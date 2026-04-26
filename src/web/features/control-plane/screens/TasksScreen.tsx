import type { ControlPlaneState } from '../../../lib/api';
import { describeHeartbeatExecution, formatDate, formatInterval, formatUsage, toneFor } from '../utils';
import { EmptyState, Pill, SideSection, WorkspaceSectionHeader } from '../components/common';
import { RunListButton, TaskListButton } from '../components/lists';
import { useIsMobile } from '../hooks/useIsMobile';
import { MobileTasksScreen } from '../mobile/MobileTasksScreen';

export type TasksScreenProps = {
  tasks: ControlPlaneState['heartbeat']['tasks'];
  runs: ControlPlaneState['heartbeat']['runs'];
  selectedTask?: ControlPlaneState['heartbeat']['tasks'][number];
  selectedTaskId?: string;
  onSelectTask: (taskId: string) => void;
  selectedRun?: ControlPlaneState['heartbeat']['runs'][number];
  selectedRunId?: string;
  onSelectRun: (runId: string) => void;
  selectedTaskRuns: ControlPlaneState['heartbeat']['runs'];
  pendingTaskAction?: {
    taskId: string;
    action: 'enable' | 'disable' | 'trigger';
  };
  onEnableTask: (taskId: string) => Promise<void>;
  onDisableTask: (taskId: string) => Promise<void>;
  onTriggerTask: (taskId: string) => Promise<void>;
};

export function TasksScreen({
  tasks,
  runs,
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
}: TasksScreenProps) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <MobileTasksScreen
        tasks={tasks}
        selectedTask={selectedTask}
        selectedTaskId={selectedTaskId}
        onSelectTask={onSelectTask}
        selectedRun={selectedRun}
        selectedRunId={selectedRunId}
        onSelectRun={onSelectRun}
        selectedTaskRuns={selectedTaskRuns}
        pendingTaskAction={pendingTaskAction}
        onEnableTask={onEnableTask}
        onDisableTask={onDisableTask}
        onTriggerTask={onTriggerTask}
      />
    );
  }

  const isTaskBusy =
    Boolean(selectedTask && pendingTaskAction && pendingTaskAction.taskId === selectedTask.taskId);
  const selectedTaskExecution = selectedTask ? describeHeartbeatExecution(selectedTask) : undefined;

  return (
    <section className="workspace-shell tasks-shell">
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

      <section className="workspace-main">
        <WorkspaceSectionHeader
          title={selectedTask?.name || selectedTask?.taskId || 'Task detail'}
          subtitle={selectedTask ? `${selectedTask.taskId} · next ${formatDate(selectedTask.nextRunAt)}` : 'Pick a task to inspect prompt, schedule, and recent outcome.'}
          actions={selectedTask ? (
            <div className="pills">
              <Pill tone={selectedTask.enabled ? 'good' : undefined}>{selectedTask.enabled ? 'enabled' : 'disabled'}</Pill>
              <Pill tone={selectedTaskExecution?.tone}>{selectedTaskExecution?.label ?? selectedTask.status}</Pill>
              {selectedTask.decision ? <Pill tone={toneFor(selectedTask.decision)}>{selectedTask.decision}</Pill> : null}
            </div>
          ) : undefined}
        />

        <div className="task-detail-scroll">
          {selectedTask ?
            <div className="detail-stack">
              <div className="detail-card">
                <p className="section-label">Task prompt</p>
                <p className="summary">{selectedTask.task}</p>
                <div className="pills approval-actions">
                  <button
                    type="button"
                    className="sidebar-action-button"
                    disabled={isTaskBusy || !selectedTask.enabled}
                    onClick={() => {
                      void onTriggerTask(selectedTask.taskId);
                    }}
                  >
                    {isTaskBusy && pendingTaskAction?.action === 'trigger' ? 'Triggering…' : 'Run now'}
                  </button>
                  {selectedTask.enabled ?
                    <button
                      type="button"
                      className="sidebar-action-button"
                      disabled={isTaskBusy}
                      onClick={() => {
                        void onDisableTask(selectedTask.taskId);
                      }}
                    >
                      {isTaskBusy && pendingTaskAction?.action === 'disable' ? 'Pausing…' : 'Pause task'}
                    </button>
                  : <button
                      type="button"
                      className="sidebar-action-button"
                      disabled={isTaskBusy}
                      onClick={() => {
                        void onEnableTask(selectedTask.taskId);
                      }}
                    >
                      {isTaskBusy && pendingTaskAction?.action === 'enable' ? 'Resuming…' : 'Resume task'}
                    </button>
                  }
                </div>
                <p className="summary">{selectedTaskExecution?.detail}</p>
              </div>

              <div className="detail-card">
                <p className="section-label">Runtime status</p>
                <div className="kv-list">
                  <div><span className="kv-key">execution</span><span className="kv-value">{selectedTaskExecution?.label ?? selectedTask.status}</span></div>
                  <div><span className="kv-key">model</span><span className="kv-value">{selectedTask.model ?? 'unset'}</span></div>
                  <div><span className="kv-key">interval</span><span className="kv-value">{formatInterval(selectedTask.intervalMs)}</span></div>
                  <div><span className="kv-key">last run</span><span className="kv-value">{formatDate(selectedTask.lastRunAt)}</span></div>
                  <div><span className="kv-key">next run</span><span className="kv-value">{formatDate(selectedTask.nextRunAt)}</span></div>
                  <div><span className="kv-key">checkpoint</span><span className="kv-value">{selectedTask.loadedCheckpoint ? 'loaded' : selectedTask.resumable ? 'resumable' : 'none'}</span></div>
                  <div><span className="kv-key">usage</span><span className="kv-value">{formatUsage(selectedTask.usage) ?? 'none'}</span></div>
                </div>
              </div>

              {selectedTask.summary ?
                <div className="detail-card">
                  <p className="section-label">Latest summary</p>
                  <p className="summary">{selectedTask.summary}</p>
                </div>
              : null}

              {selectedTask.progress ?
                <div className="detail-card">
                  <p className="section-label">Progress</p>
                  <p className="summary">{selectedTask.progress}</p>
                </div>
              : null}

              {selectedTask.error ?
                <div className="detail-card error-card">
                  <p className="section-label">Error</p>
                  <p className="summary">{selectedTask.error}</p>
                </div>
              : null}
            </div>
          : <EmptyState title="No task selected" body="Choose a task from the left to inspect its durable prompt and latest run state." />}
        </div>
      </section>

      <aside className="workspace-side">
        <WorkspaceSectionHeader
          title="Runs"
          subtitle={selectedTask ? `${selectedTaskRuns.length} run${selectedTaskRuns.length === 1 ? '' : 's'} for this task` : `${runs.length} recent run${runs.length === 1 ? '' : 's'}`}
        />
        <div className="side-scroll split-scroll">
          <SideSection title="History">
            {selectedTaskRuns.length ?
              <div className="stack-list compact">
                {selectedTaskRuns.map((run) => (
                  <RunListButton
                    key={run.id}
                    run={run}
                    active={run.id === selectedRunId}
                    onClick={() => onSelectRun(run.id)}
                  />
                ))}
              </div>
            : <EmptyState title="No runs for this task" body="Run-once and scheduled executions will appear here." />}
          </SideSection>

          <SideSection title="Run detail">
            {selectedRun ?
              <div className="detail-stack compact-stack">
                <div className="detail-card">
                  <p className="card-title">{selectedRun.id}</p>
                  <div className="pills">
                    <Pill tone={toneFor(selectedRun.status)}>{selectedRun.status}</Pill>
                    <Pill tone={toneFor(selectedRun.decision)}>{selectedRun.decision}</Pill>
                    <Pill tone={toneFor(selectedRun.outcome)}>{selectedRun.outcome}</Pill>
                  </div>
                  <p className="summary">{selectedRun.summary}</p>
                </div>

                <div className="detail-card">
                  <div className="kv-list">
                    <div><span className="kv-key">created</span><span className="kv-value">{formatDate(selectedRun.createdAt)}</span></div>
                    <div><span className="kv-key">task</span><span className="kv-value">{selectedRun.taskId}</span></div>
                    <div><span className="kv-key">usage</span><span className="kv-value">{formatUsage(selectedRun.usage) ?? 'none'}</span></div>
                    <div><span className="kv-key">checkpoint</span><span className="kv-value">{selectedRun.loadedCheckpoint ? 'loaded' : 'fresh'}</span></div>
                  </div>
                </div>

                {selectedRun.progress ?
                  <div className="detail-card">
                    <p className="section-label">Progress</p>
                    <p className="summary">{selectedRun.progress}</p>
                  </div>
                : null}
              </div>
            : <EmptyState title="No run selected" body="Select a run to inspect the latest durable heartbeat result." />}
          </SideSection>
        </div>
      </aside>
      </section>
  );
}
