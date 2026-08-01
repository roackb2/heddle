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

Scheduler state keeps the latest runner result as one nested result object instead
of copying decision, outcome, summary, and usage into separate task fields. Run
history stores the same result in a durable run record, so CLI, control-plane,
and host integrations read the same source of truth.

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

`HeartbeatSchedulerService.runDueTasks` returns durable run records, and
`heartbeat.task.finished` events include the same run record. If you need a
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
- `completeTaskExecution` and `failTaskExecution` reject a stale token with `claim-lost`
- `recoverInterruptedTasks` records the interrupted execution and makes only eligible tasks retryable

The built-in file adapter serializes those transitions within one Node.js
process and identifies executions still active in that process. Multiple
processes or replicas require a remote store backed by compare-and-swap,
transactions, or leases. Recovery cannot undo external effects, so host tools
must keep domain mutations idempotent.

Cron, launchd, systemd, hosted queues, and Lucid-style services should be treated as hosts around this API, not as Heddle's internal scheduler model.

### Custom host work with the standard agent runtime

A host can claim domain work or assemble domain tools in a custom runner, then
delegate model execution back to Heddle:

```ts
await HeartbeatSchedulerService.runDueTasks({
  store,
  runtime: {
    workspaceRoot: process.cwd(),
    stateDir: '.heddle',
    model: 'gpt-5.4',
  },
  runner: async (task, _checkpoint, context) => context.runAgent({
    task: `${task.task}\n\nReview the host-owned work claim before acting.`,
    tools: domainTools,
    includeDefaultTools: false,
  }),
});
```

`context.runAgent()` is the supported credential handoff. It uses the same
runtime builder as an ordinary heartbeat task and resolves API keys, stored
OpenAI OAuth login state, and local/OpenAI-compatible endpoints inside Heddle.
The host does not receive credential records or token fields and must not retain
the execution context. Set `preferApiKey: true` in `runtime` only when an
environment API key should take precedence over stored OpenAI OAuth state.

Custom runners still return an agent result today. Domain-level no-work skips,
execution cancellation, and awaitable custom-runner shutdown are separate
lifecycle concerns; do not fabricate an agent result to emulate those features.

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

The scheduler example uses a custom runner and `context.runAgent()` while
leaving credentials entirely inside Heddle. It works with stored OpenAI login
state or provider API-key environment variables.

## Host Notes

Heartbeat tasks can pass `maxSteps` when a runner cycle needs a hard budget.
When omitted, the core agent loop does not apply a practical default step
ceiling.

The built-in heartbeat command edge uses the same control-plane heartbeat APIs as the browser workbench. It should not own its own scheduler loop, task mutation policy, or task/run storage logic.

## See Also

- [Programmatic hosts](programmatic/README.md)
- [CLI reference](../reference/cli.md)
- [Control plane](control-plane.md)
