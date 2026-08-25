# Hosted heartbeat coordinator integration

This module is the shared boundary between a product backend and a long-running
Heddle heartbeat coordinator. It keeps coordinator protocol, reconciliation,
delegated authority, and remote-execution composition out of every adopter.

## Owns

- the authenticated coordinator state, task inspection, mutation, trigger,
  pause, resume, and drain client;
- pause-first desired-task reconciliation;
- the coordinator-to-product delegation request and response contracts;
- stable Runtime-session derivation from authorized product scope;
- construction and validation of one short-lived heartbeat authority bundle;
  and
- execution of a claimed heartbeat with that delegated bundle.

## Does not own

- product authentication, user or agent authorization, or desired-task
  projection;
- product MCP tools, product data, or the set of tools allowed for a task;
- the coordinator's database, scheduler, claims, recovery, HTTP router, or
  deployment; or
- foreground conversation relay or a general hosted control plane.

The intended division is:

```text
PRODUCT BACKEND
  project state -> desired tasks
  task/user authorization -> scope + allowed tools
        |                              ^
        | coordinator client           | delegation client
        v                              |
HEDDLE COORDINATOR --------------------+
  task store + scheduler + claims + recovery
        |
        v
HEDDLE EXECUTION HOST
```

## Publish desired task state

Product code projects its own records into Heddle task input. The shared
reconciler pauses admission, removes obsolete tasks, publishes the desired
catalog, and resumes only after every write succeeds.

```ts
import {
  HostedHeartbeatCoordinatorClient,
  HostedHeartbeatTaskReconciler,
} from '@heddleagent/execution-host-client/coordinator'

const coordinator = new HostedHeartbeatCoordinatorClient({
  baseUrl: new URL(process.env.HEDDLE_COORDINATOR_URL!),
  apiToken: process.env.HEDDLE_COORDINATOR_API_TOKEN!,
})

await new HostedHeartbeatTaskReconciler({ coordinator }).reconcile({
  desiredTasks: await projectDesiredHeartbeatTasks(),
  resume: backgroundChecksEnabled,
})
```

If reconciliation fails after pausing, the coordinator remains paused. This is
intentional: partial desired state must not start new runs.

The same client is the canonical product/operator API for current status and
explicit control. It validates Heddle's task-view vocabulary rather than
requiring each product to redefine the response or construct HTTP requests.

```ts
const tasks = await coordinator.listTasks()
const detail = await coordinator.readTask(tasks[0].taskId)
await coordinator.triggerTask(detail.task.taskId)
```

`readState()`, `pause()`, `resume()`, and `drain()` expose the coordinator
lifecycle directly. Product code still decides who may perform those actions
and how a task view appears in its UI.

## Authorize one coordinator run

The product callback makes only the product-owned decision. Heddle derives the
Runtime session, deadline, execution assertion, and MCP capability and binds
them to the coordinator's task and execution IDs.

```ts
import {
  HostedHeartbeatDelegationService,
} from '@heddleagent/execution-host-client/coordinator'

const delegations = new HostedHeartbeatDelegationService({
  authority,
  runtimeSessionNamespace: 'example-product',
  maxExecutionMs: 300_000,
  authorizer: {
    authorize: ({ taskId, signal }) =>
      authorizeProductHeartbeat({ taskId, signal }),
    // Returns { scope: { tenantId, subjectId, productSessionId }, allowedTools }
  },
})
```

Use the [`coordinator/node`](node/README.md) HTTP service to expose this issuer
from a Node backend. A coordinator consumes it through
`HostedHeartbeatDelegationClient` and
`HostedHeartbeatDelegatedExecutionTransport`; product code does not construct
or reinterpret the authority wire shape.
