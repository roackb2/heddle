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
heddle heartbeat run --concurrency 2
heddle heartbeat start --poll 60s --concurrency 2
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

Due tasks are selected in stable oldest-`nextRunAt` order with task ID as the
tie-breaker. Set `maxConcurrentTasks` to let independent tasks share a bounded
worker pool; the default is `1` for serial compatibility. Completion events are
emitted when each execution actually settles, while the returned `records`
array stays in selected-task order. The `heartbeat.task.due` event includes its
one-based queue position and current pool counts.

`HeartbeatSchedulerService.runLoop` assigns one owner identity to the current
worker generation. On startup it performs one explicit recovery pass before
polling: a task left `running` by an earlier owner becomes retryable, its last
checkpoint and run history stay intact, and the scheduler emits
`heartbeat.task.recovered` with the interrupted execution and owner IDs. A
recovered attempt never creates a successful run record. Disabled tasks remain
disabled, and blocked tasks remain blocked until an operator resumes them.

Custom stores implement this protocol through `HeartbeatTaskStore`:

- `requestTaskRun` persists a monotonically distinguishable, level-triggered run request
- `subscribeToRunRequests` optionally wakes a scheduler in the same process; polling remains the cross-process fallback
- `claimTaskExecution` atomically rechecks task eligibility plus durable
  namespace/optional-group admission and establishes the current `executionId`
  fencing token; exact recovery mode also matches and consumes its durable
  interrupted-execution marker
- `completeTaskExecution`, `failTaskExecution`, and `recordTaskExecutionOutcome` project from the latest stored task and reject a stale token with `claim-lost`
- `recoverInterruptedTasks` records the interrupted execution and makes only eligible tasks retryable

The built-in file adapter serializes those transitions within one Node.js
process and identifies executions still active in that process. Multiple
processes or replicas require a remote store backed by compare-and-swap,
transactions, or leases. Recovery cannot undo external effects, so host tools
must keep domain mutations idempotent.

Pass a custom store directly to the supported background lifecycle instead of
rebuilding the scheduler controllers around `runLoop()`:

```ts
import {
  HeartbeatSchedulerService,
  type HeartbeatTaskStore,
} from '@heddleagent/runtime/advanced';

declare const postgresHeartbeatTasks: HeartbeatTaskStore;

const scheduler = HeartbeatSchedulerService.start({
  workspaceRoot,
  stateRoot,
  store: postgresHeartbeatTasks,
  handler,
  maxConcurrentTasks: 4,
  onError: (error) => logger.error(error),
});

await scheduler.stop({ cancelRunning: true });
```

The scheduler uses that exact instance for startup recovery, request
subscriptions, due-task reads, claims, claim-fenced settlement, and run
history. `stateRoot` remains required for framework-owned agent runtime state;
when `store` is omitted it additionally selects the built-in file-backed
heartbeat store. Passing a remote task store moves only Heddle heartbeat task,
checkpoint, and run persistence. It does not move or replace the host's product
or domain database.

A production remote adapter must make claims, admission changes, and fenced writes atomic, recover
only executions whose lease or owner is no longer live, and route run-request
notifications to the scheduler process that can act on them.
`subscribeToRunRequests` is an optional low-latency hint: if an adapter cannot
deliver notifications in the current process, the configured poll interval
remains the correctness fallback. Providing an arbitrary store does not by
itself make a scheduler safe for multiple workers.

Cron, launchd, systemd, hosted queues, and Lucid-style services should be treated as hosts around this API, not as Heddle's internal scheduler model.

### Use the optional PostgreSQL authority

Install `@heddleagent/postgres` when the host needs multiple processes or
short-lived workers to share one durable heartbeat authority without
reimplementing Heddle's task transitions:

```ts
import { createPostgresHeartbeatTaskAuthority } from '@heddleagent/postgres/heartbeat';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

const database = drizzle(new Pool({
  connectionString: process.env.DATABASE_URL,
}));
const heartbeat = createPostgresHeartbeatTaskAuthority({
  database,
  namespace: trustedServiceScope,
  executionLeaseMs: 20 * 60_000,
});

const workerStore = heartbeat.store;
const operatorControls = heartbeat.administration;
```

The separate ports keep task workers least-privileged. The package supplies the
row locks, claim fencing, expired-lease recovery, checkpoints, history, and
atomic administration policy; it does not open a connection, run migrations,
authenticate a namespace, deliver tasks, or start a scheduler. Adopt the
bundled baseline SQL into exactly one application migration history, and choose
an execution lease longer than the maximum duration of one bounded attempt.
See the [published `@heddleagent/postgres` boundary](https://www.npmjs.com/package/@heddleagent/postgres)
for the full operational contract.

### Targeted one-shot workers

Use `HeartbeatSchedulerService.runTask()` when the host has already routed one
durable `taskId` to a short-lived worker. It attempts only that task once; it
does not scan other tasks merely because they are due. This is the appropriate
boundary for a queue or serverless host that first persists domain input, calls
`requestTaskRun(taskId)`, and then delivers that task ID at least once.

```ts
import {
  HeartbeatSchedulerService,
  HeartbeatTaskStateProjector,
  type HeartbeatTaskHandler,
  type HeartbeatTargetedTaskStore,
} from '@heddleagent/runtime/advanced';

declare const heartbeatTasks: HeartbeatTargetedTaskStore;
declare const taskId: string;
declare const invocationId: string;
declare const handler: HeartbeatTaskHandler;

const outcome = await HeartbeatSchedulerService.runTask({
  store: heartbeatTasks,
  taskId,
  executionOwnerId: invocationId,
  handler,
  runtime: {
    workspaceRoot,
    stateDir,
  },
  signal: workerAbortSignal,
});

if (outcome.status === 'settled') {
  await queue.acknowledge(taskId);
} else if (outcome.status === 'busy' || outcome.status === 'claim-lost') {
  await queue.retryLater(taskId);
}
```

`HeartbeatTargetedTaskStore` extends `HeartbeatTaskStore` with
`loadTask(taskId)`. A remote adapter must resolve that one task directly; do not
wrap `listTasks()` with a host-side filter, which would turn a tenant routing and
authorization boundary into a best-effort convention.

Inside each backend transaction, use `HeartbeatTaskStateProjector` to derive
the next task from the latest locked row. The projector owns Heddle's request,
claim, settlement, recovery, and normalization rules; the adapter owns atomic
persistence, execution fencing, and lease policy. Do not reimplement those
framework transitions in the host.

The result is typed so the dispatcher can make an explicit decision:

- `settled`: the claimed task wrote a durable agent, skipped, or blocked outcome and its record is available.
- `retry`: a custom handler rejected its completed nested agent result and durably scheduled the bounded retry it requested.
- `failed`: the task ran and entered the normal heartbeat failure/retry state.
- `not-found`, `disabled`, or `not-due`: this delivery has no currently eligible work.
- `admission-closed`: the namespace or assigned group currently rejects new
  claims; the result includes that blocking target.
- `busy`: another execution currently owns the task.
- `claim-lost`: the worker lost ownership before final persistence; do not treat it as success.
- `cancelled`: the worker was aborted before or during its attempt; a post-claim cancellation may include its durable record.

The method deliberately does **not** start a polling loop, subscribe to
run-request notifications, perform a global task scan, or run interrupted-task
recovery. Its final `due` claim rechecks durable enabled/running/schedule state,
so a stale queue delivery cannot bypass an operator change between lookup and
claim. That fresh claim also rechecks durable namespace and optional group
admission; a dispatcher precheck cannot replace it. A duplicate at-least-once
delivery is arbitrated by that same claim, but hosts must still make their own
domain side effects idempotent.

For a long-lived single-host scheduler, `runLoop()` performs one startup
recovery pass because it owns that process lifecycle. An ephemeral worker must
not infer that another `ownerId` is dead: an owner mismatch alone is not a lease
expiry. Remote stores need an explicit lease-expiry or operator recovery policy,
and `runTask()` never recovers or steals another worker's claim. Late settlement
writes remain fenced after an explicit recovery.

### Use the standard low-volume targeted host

Most product pilots do not need to build a queue dispatcher around `runTask()`.
`HeartbeatTargetedTaskHost` supplies an in-process default with notification
coalescing, a polling fallback, bounded concurrency, per-invocation timeouts,
pause/resume, cancellation, and periodic interrupted-owner recovery:

```ts
import {
  HeartbeatTargetedTaskHost,
  HeartbeatTargetedTaskWorker,
} from '@heddleagent/runtime/advanced';

const host = new HeartbeatTargetedTaskHost({
  store: heartbeatTasks,
  createTarget: (handler) => new HeartbeatTargetedTaskWorker({
    store: heartbeatTasks,
    handler,
    runtime: { workspaceRoot, stateDir },
  }),
  pollIntervalMs: 30_000,
  recoveryIntervalMs: 30_000,
  invocationTimeoutMs: 15 * 60_000,
  maxConcurrentInvocations: 1,
  isAdmissionEnabled: readBestEffortDispatchPrecheck,
});

host.start({ handler, admissionEnabled: true });
```

The store must already be scoped to the task or tenant namespace this process
may execute. An optional `taskIdPrefix` is defense in depth, not authorization.
Notifications are latency hints; polling durable state is the correctness path.
Only `busy` and `claim-lost` receive short delivery retries. Normal Heddle retry,
failure, not-due, admission-closed, and cancellation results wait for their
persisted schedule.

The optional `isAdmissionEnabled` callback is a fail-closed process-local
precheck that can reduce unnecessary polling or invocation. It is not the
admission authority because it can race with a claim. The store's final atomic
claim is authoritative. `host.pause()` also has different semantics: it cancels
locally active work, while closing durable admission blocks fresh logical work.
An exact recovery continuation may still run through closed admission; use
pause/drain/cancel when no execution may proceed.

This host is intentionally for low-volume single-process admission. It is not a
distributed queue, leader election service, or cross-replica concurrency limit.
Replace its invocation target or the dispatcher itself when production scale
requires a durable queue or workflow engine; keep the same targeted worker and
task-store contracts.

### Operating posture and scale-out path

Most product hosts should begin with **one active heartbeat scheduler per
durable task namespace**. The scheduler process may restart; the remote task
store keeps schedules, run requests, execution leases, checkpoints, and run
history durable. Process-local timers and delivery maps are disposable latency
mechanisms, not correctness state.

#### Make normal operation automatic without running stale tasks

For an established product, "running by default" should mean that the
product's durable desired state is `running` and the service automatically
converges the scheduler to that state. It should not mean that a replacement
scheduler blindly admits persisted tasks before the product has confirmed the
current catalog and policy.

A safe startup and restart sequence is:

1. start the scheduler endpoint with admission closed;
2. read the product's durable desired admission state and current desired task
   catalog;
3. when the desired state is `running`, reconcile the complete catalog while
   admission remains closed, then resume admission last;
4. when the desired state is `paused`, keep admission closed; and
5. periodically compare desired and actual scheduler state so a scheduler-only
   restart is detected and reconciled with bounded retry and backoff.

The convergence check should not continuously rewrite an already-correct task
catalog. Reconcile after a scheduler replacement or a known catalog revision
change; otherwise leave task timing untouched.

```ts
type BackgroundWorkDesiredState = 'running' | 'paused';

async function convergeBackgroundWork(): Promise<void> {
  const desiredState = await productState.readBackgroundWorkDesiredState();
  const actualState = await coordinator.readState();

  if (desiredState === 'paused') {
    await coordinator.pause();
    return;
  }

  if (actualState === 'paused') {
    await taskCatalogReconciler.reconcile({
      desiredTasks: await productState.readDesiredHeartbeatTasks(),
      resume: true,
    });
  }
}
```

An operator stop should persist `paused` as the product's desired state before
converging the scheduler toward it. This prevents a temporary scheduler outage
from losing the stop instruction, and the product execution lifecycle should
also fail closed while that durable gate is false. Resume performs the inverse:
persist `running`, reconcile the authoritative catalog, then reopen admission.

This provides an eventual-attempt guarantee under explicit liveness
assumptions: the durable store is reachable, an eligible task remains enabled,
a scheduler is eventually running with admission resumed, and downstream
execution eventually becomes available. Execution remains at least once.
Claim fencing rejects stale settlement, but product or external side effects
must still be idempotent.

#### Keep scheduling singular; scale execution first

A single active scheduler does not imply a single agent execution. The
scheduler is a small control-plane process that finds and claims work; the
expensive agent executions can run concurrently in remote or horizontally
scaled Execution Hosts.

Scale in stages, driven by observed saturation:

| Stage | Architecture | Change when |
| --- | --- | --- |
| Low-volume default | One targeted host polls one durable namespace and dispatches a bounded number of executions | Due-to-start latency and store load remain within the product SLO |
| Larger catalog | One scheduler queries indexed due rows in bounded batches instead of loading and filtering the complete catalog | Full-catalog scans become a material database or latency cost |
| Larger execution backlog | One scheduler publishes at-least-once task deliveries through a durable queue to a worker fleet | Local concurrency stays saturated or queued work misses its start-latency SLO |
| Multi-tenant or regional scale | Partition tasks into durable namespaces or shards, with one active scheduler leader per shard | One namespace is too large or tenants need fault and quota isolation |
| Scheduler high availability | Add active/passive leader election per namespace or shard | Scheduler replacement time no longer meets the availability SLO |

Useful scale signals are due-to-start latency, due-row query duration, pending
task count, concurrency saturation, execution failure/retry rate, and recovery
delay. Increase bounded execution concurrency and scale the remote Runtime
before multiplying scheduler processes.

#### Queue-backed execution

When a process-local dispatcher is no longer sufficient, keep PostgreSQL or
another transactional task store as the heartbeat authority and insert a
durable delivery layer between scheduling and execution:

```text
product desired state and catalog
              |
              v
durable heartbeat task authority
  (schedule, request, claim, lease, fence, history)
              |
              v
active scheduler leader ----> durable execution queue
                                      |
                                      v
                              targeted worker fleet
                                      |
                                      v
                              distributed Runtime
```

Queue messages should carry only portable routing data such as the task ID,
invocation ID, and optional observed run-request generation. Each worker still
calls `HeartbeatSchedulerService.runTask()`, which performs the final durable
eligibility check and atomic claim. A stale or duplicate queue delivery cannot
bypass a disabled task, a future schedule, or another execution owner.

For an AWS-hosted system, SQS is a reasonable durable delivery choice. A
PostgreSQL-backed queue such as pg-boss can serve the same delivery role when
operating one database is preferable. Do not let either system redefine
heartbeat schedules, claim state, or retry settlement; that would create two
competing workflow authorities. Redis Pub/Sub and PostgreSQL `LISTEN/NOTIFY`
are useful wake-up hints but are not durable correctness mechanisms by
themselves.

Multiple active schedulers over one namespace require more than atomic task
claims: admission state, global concurrency, rate limits, and operator controls
must also be shared and durable. Prefer one leader per namespace, or explicit
namespace sharding, over accidentally treating process-local limits as global
limits.

### Certify a custom targeted store

Before using a remote adapter with ephemeral or replicated workers, run the
opt-in conformance scenarios against two fresh adapter instances connected to
the same backend namespace:

```ts
import {
  HeartbeatTaskStoreConformance,
  type HeartbeatTaskStoreConformanceHarness,
} from '@heddleagent/runtime/heartbeat/testing';

const harness: HeartbeatTaskStoreConformanceHarness = {
  createStore: async (namespace) => createRemoteHeartbeatStore({ namespace }),
  createAdmissionControl: async (namespace) => createRemoteHeartbeatAdmissionControl({ namespace }),
  cleanupNamespace: async (namespace) => deleteRemoteHeartbeatFixture(namespace),
  now: () => new Date('2026-08-08T00:00:00.000Z'),
  makeExecutionRecoverable: async ({ namespace, execution, recoverAt }) => {
    await expireHeartbeatLease({ namespace, executionId: execution.executionId, recoverAt });
  },
  capabilities: {
    runRequestSubscription: true,
    runHistory: true,
  },
};

for (const scenario of HeartbeatTaskStoreConformance.createScenarios(harness)) {
  test(scenario.name, scenario.run);
}
```

The baseline scenarios verify direct lookup, shared-backend round trips,
idempotent writes, request coalescing, atomic due claims, competing workers,
claim-fenced success/failure/skip/cancellation, and explicit recovery.
`createAdmissionControl` is optional so an existing namespace-only harness
remains source-compatible, but supplying it additionally verifies
close-vs-claim linearization, active-claim survival, fail-closed assigned
groups, exact crash recovery through closed scopes, stale-ID rejection,
newer-request preservation, and unrelated-group progress. A harness that omits
the port is not scoped-admission proof. The
`makeExecutionRecoverable` hook is test-fixture authority: lease-backed stores
expire a fixture lease there; it does not add recovery authority to production
workers. Run-request subscriptions and history readback are checked only when
the adapter declares those optional capabilities.

This suite certifies the store contract, not the surrounding system. It does
not prove exactly-once domain effects, tenant authorization, queue delivery,
visibility timeout handling, or infrastructure lease correctness.

### Provider-neutral task administration

Use `HeartbeatTaskAdministrationService` as the application boundary for task
creation, configuration, pause/resume, deletion, reconciliation, and
operator-facing reads. `FileHeartbeatTaskService` implements it for local
single-process state; a relational adapter can implement the same contract for
hosted state.

```ts
import type {
  HeartbeatTaskAdministrationService,
} from '@heddleagent/runtime/advanced';

declare const heartbeatTasks: HeartbeatTaskAdministrationService;

const task = await heartbeatTasks.createTask({
  id: 'representative-alice',
  task: 'Process new information for Alice.',
  intervalMs: 60_000,
});

await heartbeatTasks.setTaskEnabled(task.taskId, false);
```

Remote implementations should reuse `HeartbeatTaskControlPolicy` for task
projections and `HeartbeatTaskViewProjector` for public views. Apply the control
policy to the latest locked row inside the same database transaction that
persists the result. The pure policy deliberately owns no transaction, lease,
tenant authorization, or notification mechanism; reading through
`loadTask()` and later writing through `saveTask()` is not an atomic
administration implementation.

The administration contract is separate from `HeartbeatTargetedTaskStore` so
execution adapters do not accidentally promise a control plane. One concrete
class may implement both when it can uphold both atomicity contracts, as the
built-in file service does for one Node.js process.

### Scoped durable admission

Use `HeartbeatTaskAdmissionControl` as the provider-neutral control boundary
for new-claim admission. It exposes one namespace-wide emergency circuit
breaker and one optional opaque `admissionGroupId` per task:

```ts
import type {
  HeartbeatTaskAdministrationService,
  HeartbeatTaskAdmissionControl,
} from '@heddleagent/runtime/advanced';

declare const tasks: HeartbeatTaskAdministrationService;
declare const admission: HeartbeatTaskAdmissionControl;

await admission.setAdmissionDecision(
  { kind: 'group', groupId: 'publisher-a' },
  'closed',
);

await tasks.createTask({
  id: 'publisher-a-digest',
  admissionGroupId: 'publisher-a',
  task: 'Process the configured publisher work.',
  intervalMs: 60_000,
});

// After any product-owned resume preparation commits successfully:
await admission.setAdmissionDecision(
  { kind: 'group', groupId: 'publisher-a' },
  'ready',
);
```

Fresh `due` and explicit `any` claims require the task to be enabled and
eligible, namespace admission to be `ready`, and the assigned group (when
present) to be `ready`.
An absent namespace decision defaults to `ready`, preserving existing
namespace-only tasks. An absent assigned-group decision defaults to `closed`,
so a partially reconciled grouped task cannot run. Ungrouped tasks never infer
membership from their ID or product data.

Group IDs are opaque, non-empty identity strings. Heddle does not canonicalize
them: task fields, admission targets, and durable admission-map keys reject
leading or trailing whitespace so visually similar identities cannot diverge.

Closing a target affects fresh logical claims only. It does not disable a task,
change its due time, consume a run request, modify its checkpoint, cancel an
active execution, or drain a worker. An exact `claimMode: 'recovery'`
continuation may bypass both closed scopes only when
`recoveryOfExecutionId` matches the current durable pending marker. The atomic
replacement consumes that marker once, preserves the interrupted run-request
correlation, and leaves any newer request pending. Stale IDs, already-consumed
markers, and recovery records from older versions without an explicit pending
marker do not authorize bypass. Scheduler and targeted-worker paths select
this mode only from the durable task marker created by
`recoverInterruptedTasks`; explicit run-now never does. Use host pause, drain,
or cancellation when no execution may proceed. Heddle does not model hosted
desired state, preparing/blocked phases, transition IDs, retry timing, restart
orchestration, or product cursor preparation; a hosted adapter owns that
lifecycle and projects only `ready | closed` into this port.

### Durable event-driven run requests

Product hosts should request prompt work through the task service instead of
editing `schedule.nextRunAt` or polling a running task:

```ts
import { FileHeartbeatTaskService } from '@heddleagent/runtime/advanced';

const heartbeatTasks = new FileHeartbeatTaskService({ stateRoot });
const request = await heartbeatTasks.requestTaskRun('mailbox-consumer', {
  reason: 'new-work-available',
});

console.log(request.disposition); // requested | coalesced
```

An idle enabled task becomes due immediately. If the task is already running,
Heddle persists one pending follow-up. Additional requests advance the durable
generation but coalesce into that same follow-up. The execution claim records
which generation it consumed, so a request arriving after the claim remains
pending for the next run. Success, failure, skip, and cancellation settle from
the latest stored task state and cannot overwrite a newer request.

`HeartbeatSchedulerService.start()` and `runLoop()` subscribe to configured-store
run requests and rescan promptly. `heartbeat.task.run_requested`,
`heartbeat.task.run_request_claimed`, and `heartbeat.scheduler.awakened` expose
the lifecycle without carrying credentials or domain payloads. The configured
poll interval remains the process-restart and external-writer fallback.

Task views expose `state.runRequest.pending`, the latest generation,
`claimedGeneration`, timestamp, and bounded operator-facing reason. Disabled,
completed, and blocked tasks reject requests; they must be enabled or resumed
explicitly instead of retaining hidden work that might run later.

### Custom host work with the standard agent runtime

A custom handler owns domain discovery and acknowledgement. Heddle owns the
execution identity, credential resolution, agent defaults, abort signal,
checkpoint, execution record, and framework events:

```ts
import {
  HeartbeatSchedulerService,
  type HeartbeatTaskHandler,
} from '@heddleagent/runtime/advanced';

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
  maxConcurrentTasks: 4,
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
  maxConcurrentTasks: 4,
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

Long-lived hosts can cancel one task without stopping its peers:

```ts
const cancellation = await scheduler.cancelTask('participant-agent-42', {
  reason: 'operator-disabled-participant',
});

if (cancellation.disposition === 'cancelled') {
  await heartbeatTasks.setTaskEnabled('participant-agent-42', false);
}
```

`cancelTask()` immediately invalidates this handle's already-queued admissions
for that task. If the handle owns an active execution, it aborts only that
execution's `HeartbeatExecutionContext.signal` and waits for the runner's
existing claim-fenced outer settlement. Unrelated active and queued tasks keep
running. Concurrent calls for the same task share the first caller's
cancellation attempt and bounded reason; a later call after settlement is a
new read of current task state and does not create another cancellation record.

The result disposition is explicit:

| Disposition | Meaning |
| --- | --- |
| `cancelled` | This handle delivered cancellation and the durable cancelled outcome won. |
| `completion-won` | Completion or failure persisted before cancellation could win. |
| `not-running` | The task exists but this handle has no active execution; any queued admission selected before the call was invalidated. |
| `not-owned` | Stored state says running, but this handle does not own the execution. A remote adapter must route a durable request to its owner. |
| `disabled` | The task exists, is disabled, and is not running. |
| `blocked` | The task is waiting for operator input and is not running. |
| `completed` | The task is terminal and is not running. |
| `not-found` | No task with that ID exists in the configured store. |

The required operator reason is trimmed, collapsed to one line, limited to 200
characters, and copied into the cancellation event and run outcome. Do not put
private task input in it. Cancellation preserves the existing checkpoint and
run history. It also preserves any run-request generation created after the
active execution's claim; that request is eligible on a later scheduler cycle.
The low-level operation deliberately does not invent disable/delete semantics
or consume that newer intent. Disabling the task after awaited cancellation
uses the task service's existing behavior to consume pending intent, and a host
may delete immediately after the await without polling for `running` state.

Task-scoped cancellation is a process-local delivery boundary for executions
started by this scheduler handle. A custom multi-worker store still needs its
own persisted cancellation-request and owner-notification protocol; a local
`not-owned` result is not an acknowledgement from the remote owner. Likewise,
Heddle cannot roll back host database writes or terminate external work that
ignores `AbortSignal`. Handlers and tools remain responsible for cooperative
cancellation and idempotent host-owned side effects.

## Examples

Follow the [progressive heartbeat SDK examples](../../examples/heartbeat/README.md)
when embedding heartbeat in a TypeScript host. They start with one durable
cycle, then add a long-lived worker, domain claim/acknowledgement, and an
event-driven durable wake-up. Each stage states the Heddle/host ownership split,
the supported topology, and its next step.

```bash
yarn example:heartbeat:one-cycle
yarn example:heartbeat:worker
yarn example:heartbeat:domain-handler
yarn example:heartbeat:events
yarn example:heartbeat:smoke # deterministic; makes no model request
```

The legacy `example:heartbeat` and `example:heartbeat-scheduler` commands stay
as compatibility entrypoints to stages 01 and 03. Stages that call `runAgent()`
need a configured model credential; set `HEDDLE_EXAMPLE_NO_WORK=true` for the
stage-03 no-work branch.

## Host Notes

Heartbeat tasks can pass `maxSteps` when a runner cycle needs a hard budget.
When omitted, the core agent loop does not apply a practical default step
ceiling.

The built-in heartbeat command edge uses the same control-plane heartbeat APIs as the browser workbench. It should not own its own scheduler loop, task mutation policy, or task/run storage logic.

## See Also

- [Programmatic hosts](programmatic/README.md)
- [Heartbeat SDK examples](../../examples/heartbeat/README.md)
- [CLI reference](../reference/cli.md)
- [Control plane](control-plane.md)
