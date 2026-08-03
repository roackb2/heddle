# Heartbeat

Heddle exposes `HeartbeatRunnerAgent.run` for autonomous, scheduler-driven agent work.

Heartbeat is not interactive chat mode. It is a host/runtime primitive for systems that want to run an agent periodically, let it work within budget and approval limits, checkpoint the result, and decide what should happen next.

Heartbeat tasks can be operated from the CLI, the browser control plane, or a custom host. The important invariant is that the durable task and run records stay local to the active workspace state root.

## Heartbeat Runner Cycle

A heartbeat runner cycle:

- loads a durable task plus an optional checkpoint
- resumes prior transcript state if available
- lets the agent do bounded useful work without a human prompt
- checkpoints the new state
- returns a decision: `continue`, `pause`, `complete`, or `escalate`

Scheduler state records the latest outer execution outcome. Agent executions
also retain their real agent result and checkpoint. A no-work skip or
cancellation instead stores a lightweight outcome with the outer `executionId`,
summary, kind, and timestamp; it does not fabricate an agent run ID, model,
provider, transcript, or checkpoint.

Task continuation is explicit. A task can be configured for operator-controlled
continuation or agent-selected continuation, and a blocked or paused task must be
resumed through the resume path rather than being silently unblocked by an
ordinary run-now action.

## CLI Usage

The installed CLI exposes the local heartbeat scheduler:

```bash
heddle heartbeat start --every 30m
heddle heartbeat task add --id repo-gardener --task "Check for safe maintenance work" --every 1h
heddle heartbeat task list
heddle heartbeat task show repo-gardener
heddle heartbeat task enable repo-gardener
heddle heartbeat run
heddle heartbeat start --poll 60s
heddle heartbeat start --once --id repo-gardener
heddle heartbeat runs list --task repo-gardener
heddle heartbeat runs show latest --task repo-gardener
```

For an OpenClaw-like local experience, `heartbeat start` creates or updates a periodic task and keeps the server-backed scheduler running in one command. It attaches to a live control-plane server when one exists, or starts an embedded server when needed. Stop the command with `Ctrl+C`.

`heartbeat run` asks the control-plane server to run due tasks now. Use `heartbeat start --once` when you want the start command to create or update a task and immediately run once.

Adding a task only saves scheduler state; it does not create an OS background service. Stop an embedded scheduler host with `Ctrl+C`, or pause a task with:

```bash
heddle heartbeat task disable repo-gardener
```

## Browser Task Workbench

The browser control plane exposes heartbeat tasks as a local task workbench. In
the web-v2 workbench, operators can create, edit, enable, disable, delete, run,
and resume tasks, choose continuation mode, select an optional model, set an
optional step budget, follow live run state, and inspect saved run records.

Browser actions use the same `FileHeartbeatTaskService` and scheduler runner
records as the CLI. There is no separate browser-only task store.

## Programmatic Scheduler Pieces

For repeated runner cycles, Heddle also exposes a local-first scheduler core:

- `HeartbeatSchedulerService.runDueTasks`
- `HeartbeatSchedulerService.runLoop`
- `FileHeartbeatTaskService`

`HeartbeatSchedulerService.runDueTasks` returns durable execution records.
`heartbeat.task.finished`, `heartbeat.task.skipped`, and
`heartbeat.task.cancelled` events include the corresponding record. If you need a
compact display shape for a UI or service integration, use
`FileHeartbeatTaskService` task/run view methods instead of flattening task
state yourself.

`HeartbeatSchedulerService.runLoop` assigns one owner identity to the current
worker generation. On startup it performs one explicit recovery pass before
polling: a task left `running` by an earlier owner becomes retryable, its last
checkpoint and run history stay intact, and the scheduler emits
`heartbeat.task.recovered` with the interrupted execution and owner IDs. A
recovered attempt never creates a successful run record. Disabled tasks remain
disabled, and blocked tasks remain blocked until an operator resumes them.

Custom stores implement this protocol through `HeartbeatTaskStore`:

- `claimTaskExecution` atomically establishes the current `executionId` fencing token
- `completeTaskExecution`, `failTaskExecution`, and `recordTaskExecutionOutcome` reject a stale token with `claim-lost`
- `recoverInterruptedTasks` records the interrupted execution and makes only eligible tasks retryable

The built-in file adapter serializes those transitions within one Node.js
process and identifies executions still active in that process. Multiple
processes or replicas require a remote store backed by compare-and-swap,
transactions, or leases. Recovery cannot undo external effects, so host tools
must keep domain mutations idempotent.

Cron, launchd, systemd, hosted queues, and Lucid-style services should be treated as hosts around this API, not as Heddle's internal scheduler model.

### Custom host work with the standard agent runtime

A custom handler owns domain discovery and acknowledgement. Heddle owns the
execution identity, credential resolution, agent defaults, abort signal,
checkpoint, execution record, and framework events:

```ts
import {
  HeartbeatSchedulerService,
  type HeartbeatTaskHandler,
} from '@roackb2/heddle/advanced';

const handler: HeartbeatTaskHandler = async (context) => {
  const claim = await domainQueue.claimNext({ signal: context.signal });
  if (!claim) {
    return context.skip({ summary: 'No eligible domain work was available.' });
  }

  const result = await context.runAgent({
    task: `${context.task.task}\n\nClaimed work: ${claim.instruction}`,
    systemContext: `Operate only on claim ${claim.id}.`,
    tools: domainTools,
    includeDefaultTools: false,
  });

  await domainQueue.acknowledge(claim.id, { summary: result.summary });
  return result;
};

await HeartbeatSchedulerService.runDueTasks({
  store,
  runtime: {
    workspaceRoot: process.cwd(),
    stateDir: '.heddle',
    model: 'gpt-5.4',
  },
  handler,
});
```

The context also includes a cloned task and checkpoint, the outer
`executionId`, scheduled `runAt`, and a framework-owned `AbortSignal`.
`context.runAgent()` is the supported credential handoff. It uses the same
runtime builder as an ordinary heartbeat task and resolves API keys, stored
OpenAI OAuth login state, and local/OpenAI-compatible endpoints inside Heddle.
The host does not receive credential records or token fields and must not retain
the execution context. Set `preferApiKey: true` in `runtime` only when an
environment API key should take precedence over stored OpenAI OAuth state.

Call `context.runAgent()` at most once, or return the exact outcome from
`context.skip()`. Context methods are invalid after the handler settles. The
older positional `runner(task, checkpoint, context)` callback remains as a
deprecated compatibility adapter, but it uses this same internal execution and
persistence pipeline.

### Awaitable shutdown and cancellation

The background scheduler separates admission shutdown from active-work
cancellation:

```ts
const scheduler = HeartbeatSchedulerService.start({
  workspaceRoot,
  stateRoot,
  handler,
});

// Stop polling, abort the active execution, and wait for handler settlement
// plus Heddle's final claim-fenced persistence.
await scheduler.stop({ cancelRunning: true });
```

Calling `stop()` without `cancelRunning` drains the active execution while
stopping new admissions. Repeated calls return the same stop promise; a later
call may still upgrade a drain to cancellation. A cancelled execution is
recorded separately from failure and becomes retryable without using the
failure-delay path.

Heddle cannot force arbitrary host code to observe `AbortSignal`. If a handler
ignores cancellation, `stop()` deliberately remains pending until that handler
settles. The execution fencing token prevents its late result from overwriting
a replacement claim, and a result that settles after the framework signal was
aborted is persisted as cancellation rather than agent completion.

## Examples

Try a small local heartbeat example:

```bash
export OPENAI_API_KEY=your_key_here
yarn example:heartbeat
```

Try the local scheduler API with a real LLM:

```bash
export OPENAI_API_KEY=your_key_here
yarn example:heartbeat-scheduler
```

The scheduler example demonstrates claim, no-work skip, dynamic prompt/tools,
agent execution, and host acknowledgement while leaving credentials entirely
inside Heddle. It works with stored OpenAI login state or provider API-key
environment variables. Set `HEDDLE_EXAMPLE_NO_WORK=true` to exercise the
zero-model skip path.

## Host Notes

Heartbeat tasks can pass `maxSteps` when a runner cycle needs a hard budget.
When omitted, the core agent loop does not apply a practical default step
ceiling.

The built-in heartbeat command edge uses the same control-plane heartbeat APIs as the browser workbench. It should not own its own scheduler loop, task mutation policy, or task/run storage logic.

## See Also

- [Programmatic hosts](programmatic/README.md)
- [CLI reference](../reference/cli.md)
- [Control plane](control-plane.md)
