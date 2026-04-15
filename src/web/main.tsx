import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { fetchControlPlaneState, type ControlPlaneState } from './lib/api';
import './styles.css';

type Tab = 'overview' | 'sessions' | 'heartbeat';

function App() {
  const [tab, setTab] = useState<Tab>('overview');
  const [state, setState] = useState<ControlPlaneState | undefined>();
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try {
        const next = await fetchControlPlaneState();
        if (!cancelled) {
          setState(next);
          setError(undefined);
        }
      } catch (refreshError) {
        if (!cancelled) {
          setError(refreshError instanceof Error ? refreshError.message : String(refreshError));
        }
      }
    }

    void refresh();
    const interval = window.setInterval(refresh, 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  return (
    <main className="shell">
      <header className="hero">
        <div>
          <p className="eyebrow">Localhost Control Plane</p>
          <h1>Heddle, from terminal loop to workstation.</h1>
          <p className="lede">
            Inspect Heddle-managed sessions, autonomous heartbeat tasks, and recent agent run state from a responsive browser surface.
          </p>
        </div>
        <StatusBadge error={error} state={state} />
      </header>

      <nav className="tabs" aria-label="Control plane sections">
        <TabButton active={tab === 'overview'} onClick={() => setTab('overview')}>Overview</TabButton>
        <TabButton active={tab === 'sessions'} onClick={() => setTab('sessions')}>Sessions</TabButton>
        <TabButton active={tab === 'heartbeat'} onClick={() => setTab('heartbeat')}>Heartbeat</TabButton>
      </nav>

      {!state ?
        <Panel title="Loading">
          <p className="muted">{error ?? 'Reading local Heddle state...'}</p>
        </Panel>
      : tab === 'overview' ?
        <Overview state={state} />
      : tab === 'sessions' ?
        <Sessions state={state} />
      : <Heartbeat state={state} />}
    </main>
  );
}

function Overview({ state }: { state: ControlPlaneState }) {
  return (
    <section className="grid">
      <Panel title="Workspace">
        <p className="strong">{state.workspaceRoot}</p>
        <p className="muted">state: {state.stateRoot}</p>
      </Panel>
      <Metric title="Sessions" value={state.sessions.length} caption="chat sessions" />
      <Metric title="Heartbeat" value={state.heartbeat.tasks.length} caption={`${state.heartbeat.runs.length} recent runs`} />
      <Panel title="Recent Sessions" wide>
        <List items={state.sessions.slice(0, 5)} render={(session) => <SessionItem session={session} />} />
      </Panel>
      <Panel title="Recent Runs">
        <List items={state.heartbeat.runs.slice(0, 6)} render={(run) => <RunItem run={run} />} />
      </Panel>
    </section>
  );
}

function Sessions({ state }: { state: ControlPlaneState }) {
  return (
    <section className="grid">
      <Panel title="Chat Sessions" wide>
        <List items={state.sessions} render={(session) => <SessionItem session={session} />} />
      </Panel>
      <Panel title="API">
        <Code>trpc.controlPlane.sessions.query()</Code>
      </Panel>
    </section>
  );
}

function Heartbeat({ state }: { state: ControlPlaneState }) {
  return (
    <section className="grid">
      <Panel title="Tasks" wide>
        <List items={state.heartbeat.tasks} render={(task) => <TaskItem task={task} />} />
      </Panel>
      <Panel title="Recent Runs">
        <List items={state.heartbeat.runs} render={(run) => <RunItem run={run} />} />
      </Panel>
    </section>
  );
}

function SessionItem({ session }: { session: ControlPlaneState['sessions'][number] }) {
  return (
    <article className="item">
      <h3>{session.name}</h3>
      <p className="muted">{session.id} · updated {formatDate(session.updatedAt)}</p>
      <div className="pills">
        <Pill>{session.model ?? 'model unset'}</Pill>
        <Pill>turns {session.turnCount}</Pill>
        <Pill tone={session.driftEnabled ? 'good' : undefined}>{session.driftEnabled ? 'drift on' : 'drift off'}</Pill>
      </div>
      {session.lastPrompt ? <p className="summary"><strong>Last prompt:</strong> {short(session.lastPrompt)}</p> : null}
      {session.lastSummary ? <p className="summary">{short(session.lastSummary)}</p> : null}
    </article>
  );
}

function TaskItem({ task }: { task: ControlPlaneState['heartbeat']['tasks'][number] }) {
  return (
    <article className="item">
      <h3>{task.name || task.taskId}</h3>
      <p className="muted">{task.taskId} · next {formatDate(task.nextRunAt)}</p>
      <div className="pills">
        <Pill tone={task.enabled ? 'good' : undefined}>{task.enabled ? 'enabled' : 'disabled'}</Pill>
        <Pill tone={toneFor(task.status)}>{task.status}</Pill>
        {task.decision ? <Pill tone={toneFor(task.decision)}>{task.decision}</Pill> : null}
      </div>
      <p className="summary">{short(task.task, 260)}</p>
      {task.summary ? <p className="summary">{short(task.summary)}</p> : null}
    </article>
  );
}

function RunItem({ run }: { run: ControlPlaneState['heartbeat']['runs'][number] }) {
  return (
    <article className="item">
      <h3>{run.taskId}</h3>
      <p className="muted">{run.id} · {formatDate(run.createdAt)}</p>
      <div className="pills">
        <Pill tone={toneFor(run.decision)}>{run.decision}</Pill>
        <Pill tone={toneFor(run.outcome)}>{run.outcome}</Pill>
        <Pill tone={toneFor(run.status)}>{run.status}</Pill>
      </div>
      <p className="summary">{short(run.summary, 280)}</p>
    </article>
  );
}

function Panel({ title, children, wide = false }: { title: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <section className={wide ? 'panel wide' : 'panel'}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function Metric({ title, value, caption }: { title: string; value: number; caption: string }) {
  return (
    <Panel title={title}>
      <p className="metric">{value}</p>
      <p className="muted">{caption}</p>
    </Panel>
  );
}

function List<T>({ items, render }: { items: T[]; render: (item: T) => React.ReactNode }) {
  return items.length ? <div className="list">{items.map((item, index) => <div key={index}>{render(item)}</div>)}</div> : <p className="empty">No records yet.</p>;
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button className={active ? 'active' : ''} onClick={onClick}>{children}</button>;
}

function StatusBadge({ error, state }: { error?: string; state?: ControlPlaneState }) {
  if (error) {
    return <aside className="status bad">Error: {error}</aside>;
  }
  return <aside className="status">{state?.workspaceRoot ?? 'Connecting...'}</aside>;
}

function Pill({ children, tone }: { children: React.ReactNode; tone?: 'good' | 'warn' | 'bad' }) {
  return <span className={tone ? `pill ${tone}` : 'pill'}>{children}</span>;
}

function Code({ children }: { children: React.ReactNode }) {
  return <pre>{children}</pre>;
}

function toneFor(value: string | undefined): 'good' | 'warn' | 'bad' | undefined {
  if (!value) {
    return undefined;
  }
  if (value === 'complete' || value === 'continue' || value === 'done' || value === 'idle') {
    return 'good';
  }
  if (value === 'blocked' || value === 'escalate' || value === 'waiting') {
    return 'warn';
  }
  if (value === 'failed') {
    return 'bad';
  }
  return undefined;
}

function formatDate(value: string | undefined): string {
  return value ? new Date(value).toLocaleString() : 'none';
}

function short(value: string, length = 220): string {
  return value.length > length ? `${value.slice(0, length - 1)}…` : value;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
