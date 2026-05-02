import type { ControlPlaneState } from '../../../../lib/api';
import { EmptyState, Pill, SideSection, WorkspaceSectionHeader } from '../common';
import { RunListButton } from '../lists';
import { formatDate, formatUsage, toneFor } from '../../utils';

export function RunsPanel({
  runs,
  selectedTask,
  selectedTaskRuns,
  selectedRun,
  selectedRunId,
  onSelectRun,
}: {
  runs: ControlPlaneState['heartbeat']['runs'];
  selectedTask?: ControlPlaneState['heartbeat']['tasks'][number];
  selectedTaskRuns: ControlPlaneState['heartbeat']['runs'];
  selectedRun?: ControlPlaneState['heartbeat']['runs'][number];
  selectedRunId?: string;
  onSelectRun: (runId: string) => void;
}) {
  return (
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
  );
}
