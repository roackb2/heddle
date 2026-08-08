# Heartbeat SDK examples

These examples are a progressive path for hosts that need bounded autonomous
work. They import the supported `@roackb2/heddle/advanced` heartbeat surface;
they do not reach into Heddle source internals. Build this repository before
running an example so that its package export exists locally:

```bash
yarn build
```

For an installed package, install `@roackb2/heddle` and run the same code in a
Node.js 20+ TypeScript/ESM host with a configured Heddle model credential.
Stages that call `runAgent()` use that credential. Their model budget is capped
at two steps only to keep the examples inexpensive; choose a production budget
for the work and controls you actually operate.

Every stage uses `reconcileTasks()` at startup. Re-running an example therefore
creates a missing task without overwriting its durable state, pending request,
checkpoint association, or operator changes. Use the explicit task update APIs
when the host intentionally changes an existing task.

## Choose by two independent axes

First choose the **host topology**. Then choose how deeply the host needs to
customize one heartbeat execution. Do not mistake a customization stage for a
distributed-systems guarantee.

| Host topology | Supported starting point | Boundary to keep explicit |
| --- | --- | --- |
| Managed local CLI/control plane | `heddle heartbeat …` | Heddle owns the local scheduler process and file-backed heartbeat state. |
| Embedded TypeScript process | 01 or 03 | Your process owns startup, shutdown, and its state-root filesystem. |
| Long-lived worker or server | 02 or 04 | Your host owns supervision, signals, deployment, and operational alerts. |
| Custom persistence | 02 with `store` | The adapter must atomically claim and fence writes; Heddle does not supply distributed leases. |
| Ephemeral queue/serverless worker | 05 with a conforming remote store | Route one task ID; your host owns queue visibility, leases, recovery, and domain idempotency. |
| Multiple workers or replicas | 05 with a conforming remote store plus your queue/leases | Route payloads, cancellation, recovery, and idempotency through your own durable infrastructure. |

| Customization depth | Stage | What Heddle owns | What the host owns |
| --- | --- | --- | --- |
| One cycle | [01 one cycle](01-one-cycle.ts) | Checkpoint, credentials, agent execution, task/run record | State location and when to call one cycle |
| Worker lifecycle | [02 long-lived worker](02-long-lived-worker.ts) | Scheduler admissions and claim-fenced settlement | Process supervision and awaited shutdown |
| Domain work | [03 domain handler](03-domain-handler.ts) | Execution identity, `AbortSignal`, credentials, agent path | Claim, postcondition, acknowledgement |
| Event-driven work | [04 event-driven wake](04-event-driven-wake.ts) | Durable, coalescible run-request generation | Event payload, delivery, domain idempotency |
| Targeted execution | [05 ephemeral worker](05-ephemeral-worker.ts) | Exact task lookup, final due claim, fenced settlement | Task routing, queue retry/visibility, lease recovery |

## Follow the path

1. `01-one-cycle.ts` calls `runDueTasks()` once after writing one task. It is
   the smallest durable cycle, not a background service. **Next:** stage 02.
2. `02-long-lived-worker.ts` uses `HeartbeatSchedulerService.start()` and
   awaits `stop({ cancelRunning: true })` on shutdown. It is one worker around
   the built-in file store. **Next:** stage 03 if you own domain work.
3. `03-domain-handler.ts` demonstrates claim → no-work skip or `runAgent()` →
   host postcondition → acknowledgement. Heddle never exposes credential
   records to the handler. **Next:** stage 04 when product events should wake
   work promptly.
4. `04-event-driven-wake.ts` uses an in-memory host `Map` only to illustrate
   ownership; a production host needs a durable inbox. The Heddle task receives
   only a bounded reason and durable generation, and the example removes a
   payload only after the agent succeeds. Repeated wakes coalesce, so the host
   must retain every payload and make its effects idempotent. **Next:** replace
   the built-in store only after designing its atomic claim, fencing, lease
   recovery, and payload-delivery contracts.
5. `05-ephemeral-worker.ts` demonstrates an at-least-once queue delivery by
   running exactly one routed task ID. It proves an unrelated due task remains
   pending and a duplicate delivery does not rerun settled work. The file store
   keeps the example deterministic; production replicas need a remote store
   certified with `@roackb2/heddle/heartbeat/testing`. **Next:** implement the
   host's queue acknowledgement, lease expiry, and domain idempotency policy.

## Commands

```bash
yarn example:heartbeat:one-cycle
yarn example:heartbeat:worker
yarn example:heartbeat:domain-handler
yarn example:heartbeat:events
yarn example:heartbeat:ephemeral
yarn example:heartbeat:smoke
```

`example:heartbeat:smoke` makes no model request. It proves task creation,
no-work skip persistence, durable run request wake-up, and awaited graceful
scheduler shutdown.
