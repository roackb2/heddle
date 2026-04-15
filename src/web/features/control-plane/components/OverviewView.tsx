import type { ControlPlaneState } from '../../../lib/api';
import { formatNumber } from '../utils';
import { EmptyState, Panel } from './common';
import { SessionListButton, RunListButton } from './lists';

export function OverviewView({ state }: { state: ControlPlaneState }) {
  return (
    <section className="overview-grid">
      <Panel title="Workspace">
        <div className="kv-list">
          <div>
            <span className="kv-key">workspace</span>
            <span className="kv-value path">{state.workspaceRoot}</span>
          </div>
          <div>
            <span className="kv-key">state</span>
            <span className="kv-value path">{state.stateRoot}</span>
          </div>
        </div>
      </Panel>
      <Panel title="Chat Sessions">
        <p className="metric">{formatNumber(state.sessions.length)}</p>
        <p className="muted">Saved conversations available for the workstation shell.</p>
      </Panel>
      <Panel title="Heartbeat Tasks">
        <p className="metric">{formatNumber(state.heartbeat.tasks.length)}</p>
        <p className="muted">Durable tasks with {state.heartbeat.runs.length} recent runs.</p>
      </Panel>
      <Panel title="Recent sessions" wide>
        {state.sessions.length ?
          <div className="stack-list">
            {state.sessions.slice(0, 5).map((session) => (
              <SessionListButton key={session.id} session={session} active={false} onClick={() => undefined} />
            ))}
          </div>
        : <EmptyState title="No sessions yet" body="Start chat in the TUI first, then reopen the control plane." />}
      </Panel>
      <Panel title="Recent task runs" wide>
        {state.heartbeat.runs.length ?
          <div className="stack-list compact">
            {state.heartbeat.runs.slice(0, 6).map((run) => (
              <RunListButton key={run.id} run={run} active={false} onClick={() => undefined} />
            ))}
          </div>
        : <EmptyState title="No task runs yet" body="Heartbeat run history will appear here after the first wake cycle." />}
      </Panel>
    </section>
  );
}
