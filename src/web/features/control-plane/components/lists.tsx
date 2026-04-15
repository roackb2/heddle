import type { ChatSessionDetail, ChatTurnReview, ControlPlaneState } from '../../../lib/api';
import { formatShortDate, short, toneFor, className } from '../utils';
import { CodeBlock, EmptyState, Pill } from './common';

export function SessionListButton({
  session,
  active,
  onClick,
}: {
  session: ControlPlaneState['sessions'][number];
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button className={className('list-button', active && 'active')} type="button" onClick={onClick}>
      <div className="list-button-header">
        <strong>{session.name}</strong>
        <span>{formatShortDate(session.updatedAt)}</span>
      </div>
      <div className="pills compact-pills">
        <Pill>{session.model ?? 'unset model'}</Pill>
        <Pill>turns {session.turnCount}</Pill>
      </div>
      {session.lastPrompt ? <p className="button-copy"><strong>Prompt:</strong> {short(session.lastPrompt, 88)}</p> : null}
      {session.lastSummary ? <p className="button-copy muted-copy">{short(session.lastSummary, 120)}</p> : null}
    </button>
  );
}

export function TaskListButton({
  task,
  active,
  onClick,
}: {
  task: ControlPlaneState['heartbeat']['tasks'][number];
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button className={className('list-button', active && 'active')} type="button" onClick={onClick}>
      <div className="list-button-header">
        <strong>{task.name || task.taskId}</strong>
        <span>{formatShortDate(task.nextRunAt)}</span>
      </div>
      <div className="pills compact-pills">
        <Pill tone={task.enabled ? 'good' : undefined}>{task.enabled ? 'enabled' : 'disabled'}</Pill>
        <Pill tone={toneFor(task.status)}>{task.status}</Pill>
      </div>
      <p className="button-copy">{short(task.task, 112)}</p>
    </button>
  );
}

export function RunListButton({
  run,
  active,
  onClick,
}: {
  run: ControlPlaneState['heartbeat']['runs'][number];
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button className={className('list-button compact-button', active && 'active')} type="button" onClick={onClick}>
      <div className="list-button-header">
        <strong>{run.id}</strong>
        <span>{formatShortDate(run.createdAt)}</span>
      </div>
      <div className="pills compact-pills">
        <Pill tone={toneFor(run.status)}>{run.status}</Pill>
        <Pill tone={toneFor(run.decision)}>{run.decision}</Pill>
      </div>
      <p className="button-copy muted-copy">{short(run.summary, 96)}</p>
    </button>
  );
}

export function TurnListButton({
  turn,
  active,
  onClick,
}: {
  turn: Exclude<ChatSessionDetail, null>['turns'][number];
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button className={className('list-button compact-button', active && 'active')} type="button" onClick={onClick}>
      <div className="list-button-header">
        <strong>{turn.prompt}</strong>
        <span>{turn.steps} steps</span>
      </div>
      <div className="pills compact-pills">
        <Pill tone={toneFor(turn.outcome)}>{turn.outcome}</Pill>
      </div>
      <p className="button-copy muted-copy">{short(turn.summary, 110)}</p>
    </button>
  );
}

export function CommandList({ commands, empty }: { commands: Exclude<ChatTurnReview, null>['reviewCommands']; empty: string }) {
  return commands.length ? (
    <div className="stack-list compact">
      {commands.map((command) => (
        <div className="detail-card" key={`${command.tool}-${command.command}`}>
          <p className="card-title">{command.command}</p>
          <div className="pills compact-pills">
            <Pill>{command.tool}</Pill>
            <Pill tone={command.exitCode === 0 ? 'good' : command.exitCode === undefined ? undefined : 'bad'}>
              exit {command.exitCode ?? 'n/a'}
            </Pill>
          </div>
          {command.stdout ? <CodeBlock>{command.stdout}</CodeBlock> : null}
          {command.stderr ? <CodeBlock>{command.stderr}</CodeBlock> : null}
        </div>
      ))}
    </div>
  ) : <EmptyState title="No evidence" body={empty} />;
}
