import type { ControlPlaneHeartbeatRun, ControlPlaneHeartbeatTaskView } from '@web/api/client';
import { AssistantMarkdown } from '@web/components/conversation/AssistantMarkdown';
import { formatTaskTimestamp, formatUsage } from './task-format';

interface TaskRunDetailsPanelProps {
  run: ControlPlaneHeartbeatRun['run'];
  liveTask?: ControlPlaneHeartbeatTaskView;
  loading: boolean;
  error?: string;
  showingLiveRun?: boolean;
}

export function TaskRunDetailsPanel({
  run,
  liveTask,
  loading,
  error,
  showingLiveRun = false,
}: TaskRunDetailsPanelProps) {
  const showLiveTask = Boolean(liveTask && (liveTask.state.status === 'running' || liveTask.state.progress?.startsWith('Task queued')));
  return (
    <div className="v2-task-inspector flex h-full min-w-0 flex-col">
      <header className="v2-panel-divider border-b px-4 py-3">
        <p className="v2-type-panel-title text-foreground">Run details</p>
        <p className="v2-type-panel-subtitle text-muted-foreground">Selected task run</p>
      </header>
      <div className="v2-scrollbar-hidden min-h-0 flex-1 overflow-auto px-4 py-4">
        {showLiveTask && liveTask && !showingLiveRun ? (
          <div className="mb-5">
            <TaskDetailBlock title={liveTask.state.status === 'running' ? 'Running now' : 'Latest task status'} body={liveTask.state.progress ?? liveTask.state.status} />
          </div>
        ) : null}
        {showingLiveRun ? (
          liveTask ? (
            <div className="flex min-w-0 flex-col gap-5">
              <TaskDetailBlock title={liveTask.state.status === 'running' ? 'Running now' : 'Latest task status'} body={liveTask.state.progress ?? liveTask.state.status} />
              <TaskDetailRows
                rows={[
                  ['status', liveTask.state.status],
                  ['started', formatTaskTimestamp(liveTask.state.runAt)],
                  ['checkpoint', liveTask.state.loadedCheckpoint ? 'loaded' : 'pending'],
                ]}
              />
            </div>
          ) : (
            <TaskInspectorEmpty title="No live run" body="The live run is no longer active." />
          )
        ) : loading ? (
          <TaskInspectorEmpty title="Loading run" body="Reading the selected heartbeat run." />
        ) : error ? (
          <TaskInspectorEmpty title="Run unavailable" body={error} />
        ) : run ? (
          <div className="flex min-w-0 flex-col gap-5">
            <section className="min-w-0">
              <p className="v2-type-body-strong truncate text-foreground">{formatTaskTimestamp(run.createdAt)}</p>
            </section>
            <TaskDetailRows
              rows={[
                ['decision', run.result.decision],
                ['outcome', run.result.outcome],
                ['usage', formatUsage(run.result.usage)],
                ['checkpoint', run.loadedCheckpoint ? 'loaded' : 'not loaded'],
              ]}
            />
            <TaskMarkdownBlock title="Task result" body={run.result.summary} />
            {run.task.state.progress ? <TaskDetailBlock title="Progress" body={run.task.state.progress} /> : null}
            {run.task.state.error ? <TaskDetailBlock title="Error" body={run.task.state.error} /> : null}
          </div>
        ) : (
          <TaskInspectorEmpty title="No run selected" body="Select a run from the task workbench." />
        )}
      </div>
    </div>
  );
}

function TaskDetailRows({ rows }: { rows: Array<[string, string]> }) {
  return (
    <dl className="grid min-w-0 grid-cols-[6rem_minmax(0,1fr)] gap-x-3 gap-y-2">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="v2-type-caption text-muted-foreground">{label}</dt>
          <dd className="v2-type-caption min-w-0 truncate text-foreground">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function TaskDetailBlock({
  title,
  body,
}: {
  title: string;
  body: string;
}) {
  return (
    <section className="min-w-0">
      <h3 className="v2-type-panel-title text-foreground">{title}</h3>
      <p className="v2-type-panel-subtitle mt-1 text-pretty text-muted-foreground">{body}</p>
    </section>
  );
}

function TaskMarkdownBlock({
  title,
  body,
}: {
  title: string;
  body: string;
}) {
  return (
    <section className="min-w-0">
      <h3 className="v2-type-panel-title text-foreground">{title}</h3>
      <div className="v2-task-result-markdown mt-1 text-muted-foreground">
        <AssistantMarkdown markdown={body} />
      </div>
    </section>
  );
}

function TaskInspectorEmpty({
  title,
  body,
}: {
  title: string;
  body: string;
}) {
  return (
    <div className="flex h-full min-h-[12rem] flex-col justify-center">
      <p className="v2-type-body-strong text-foreground">{title}</p>
      <p className="v2-type-panel-subtitle mt-1 text-muted-foreground">{body}</p>
    </div>
  );
}
