import type { ControlPlaneState } from '../../../../lib/api';
import { EmptyState, Pill, WorkspaceSectionHeader } from '../common';
import { formatDate, formatInterval, formatUsage, toneFor } from '../../utils';

export function TaskDetailPanel({
  selectedTask,
  pendingTaskAction,
  isTaskBusy,
  selectedTaskExecution,
  onEnableTask,
  onDisableTask,
  onTriggerTask,
}: {
  selectedTask?: ControlPlaneState['heartbeat']['tasks'][number];
  pendingTaskAction?: { taskId: string; action: 'enable' | 'disable' | 'trigger' };
  isTaskBusy: boolean;
  selectedTaskExecution?: { label: string; tone: 'good' | 'warn' | 'bad' | undefined; detail: string };
  onEnableTask: (taskId: string) => Promise<void>;
  onDisableTask: (taskId: string) => Promise<void>;
  onTriggerTask: (taskId: string) => Promise<void>;
}) {
  return (
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
  );
}
