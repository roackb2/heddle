# Targeted heartbeat task host

This subdomain is Heddle's low-volume default for request-driven heartbeat
execution. It saves adopters from rebuilding durable notification coalescing,
polling fallback, bounded local concurrency, invocation timeouts, cancellation,
and expired-owner recovery around `HeartbeatSchedulerService.runTask()`.

## Responsibilities

- `HeartbeatTargetedTaskWorker` executes exactly one routed task through
  Heddle's direct lookup, due claim, checkpoint, handler, and fenced settlement.
- `HeartbeatTargetedTaskDispatcher` treats run-request notifications as a fast
  hint, polls durable task state as the correctness fallback, coalesces task
  generations, and retries only transient `busy` or `claim-lost` deliveries.
- `HeartbeatTargetedTaskHost` adds store subscription, recovery cadence,
  process-local pause/resume, and cancellation classification.

## Boundaries

The task store remains the durable authority. A product remains responsible for
creating/reconciling tasks, controlling the separate durable
`HeartbeatTaskAdmissionControl` port, domain input and idempotency, and deciding
which task namespace this host may see. The store's final claim must serialize
namespace and optional group admission with task eligibility. The host does
not provide a distributed queue, leader election, or cross-process concurrency
limit. Use a queue-backed dispatcher when scale or availability requires it;
the replaceable invocation-target port preserves that migration seam.
See the public heartbeat guide's
[operating posture and scale-out path](../../../../docs/guides/heartbeat.md#operating-posture-and-scale-out-path)
for the default-running convergence model, scaling signals, and staged queue or
sharding architecture.

`isAdmissionEnabled` is only a best-effort precheck that avoids unnecessary
polling or invocation. It is not the durable authority because it can race with
the final claim. Likewise, `host.pause()` is a process-local drain/cancellation
operation. Closing durable namespace or group admission blocks fresh logical
work but does not cancel or strand already admitted work. An exact durable
single-use recovery replacement may bypass both scopes; caller-selected stale
IDs cannot. Use host pause, drain, or cancellation when no execution may
proceed.

`taskIdPrefix` is an optional defense-in-depth filter, not an authorization
boundary. Prefer giving each host a store already scoped to its tenant or task
namespace. `recoveryIntervalMs` must be shorter than the remote store's
execution lease so expired ownership is revisited promptly.

## Typical composition

```ts
const host = new HeartbeatTargetedTaskHost({
  store,
  createTarget: (handler) => new HeartbeatTargetedTaskWorker({
    store,
    handler,
    runtime: { workspaceRoot, stateDir },
  }),
  pollIntervalMs: 30_000,
  recoveryIntervalMs: 30_000,
  invocationTimeoutMs: 15 * 60_000,
  maxConcurrentInvocations: 1,
  isAdmissionEnabled: readBestEffortDispatchPrecheck,
})

host.start({ handler, admissionEnabled: true })
```
