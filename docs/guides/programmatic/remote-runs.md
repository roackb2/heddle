# Remote Conversation Runs

Use the remote-run layer when a client observes a Heddle conversation through
a transport and may disconnect or reconnect while the run continues.

The public layers are intentionally separate:

```ts
import { createConversationEngine } from '@roackb2/heddle'
import { ConversationRunService } from '@roackb2/heddle/hosted'
import {
  ConversationRunConsumerService,
  ConversationRunProtocolCodec,
} from '@roackb2/heddle/remote'
```

- `@roackb2/heddle` owns persisted conversation semantics.
- `@roackb2/heddle/hosted` owns process-local active-run coordination.
- `@roackb2/heddle/remote` owns client cursor correctness and runtime wire
  validation without choosing HTTP, SSE, tRPC, WebSocket, React, or auth.

## Define the public wire payload

Heddle owns the run envelope and terminal vocabulary. The host must explicitly
choose which activity and result fields are safe for remote clients. Payload
validators use the validator-neutral
[Standard Schema](https://standardschema.dev/schema) interface; Zod 3.24+, Zod
4, Valibot, ArkType, and other compatible validators work without adapters.

```ts
import { z } from 'zod'
import { ConversationRunProtocolCodec } from '@roackb2/heddle/remote'

const PublicActivitySchema = z.object({
  type: z.string().min(1),
}).passthrough()

const PublicResultSchema = z.object({
  outcome: z.string().min(1),
  summary: z.string(),
})

const protocol = new ConversationRunProtocolCodec({
  activity: PublicActivitySchema,
  result: PublicResultSchema,
})
```

Payload validation must be synchronous because streaming parse and
serialization are synchronous. The codec rejects an asynchronous validator with
a clear boundary error.

`protocol.parseEvent(untrustedValue)` validates:

- non-empty `runId`;
- positive safe-integer `sequence`;
- ISO timestamp;
- one of `activity`, `result`, `cancelled`, or `error`;
- the host-supplied activity/result schema;
- JSON-safe values after schema parsing.

`protocol.stringifyEvent(value)` applies the same validation before JSON
serialization. This prevents passthrough or `unknown` payloads from carrying
values such as bigint, functions, symbols, non-finite numbers, or `undefined`
into a transport.

Use strict public schemas when internal activity can contain tool inputs,
results, filesystem paths, or other sensitive data. The codec validates the
schema you choose; it does not decide product authorization or sanitize secrets
on your behalf.

## Consume one run correctly

The consumer is a transport-neutral state machine. A reference may include any
host fields as long as it has a stable `runId`:

```ts
import { ConversationRunConsumerService } from '@roackb2/heddle/remote'

type ProductRunReference = {
  accountId: string
  sessionId: string
  runId: string
}

const consumer = new ConversationRunConsumerService<ProductRunReference>({
  retry: {
    maxAttempts: 6,
    baseDelayMs: 500,
    maxDelayMs: 4_000,
  },
})

consumer.select({ accountId, sessionId, runId })
```

Before opening a subscription, ask the consumer for the canonical cursor:

```ts
const input = consumer.subscriptionInput()

if (input) {
  await transport.subscribe({
    ...input,
    onEvent(rawEvent) {
      const event = protocol.parseEvent(rawEvent)
      const acceptance = consumer.accept(event)
      if (acceptance.accepted) {
        renderProductEvent(event)
      }
    },
  })
}
```

`accept(...)`:

- ignores an event for another run;
- ignores an already accepted replay sequence;
- throws on a sequence gap;
- advances the cursor only after accepting an event;
- recognizes result/cancel/error as terminal;
- rejects a later event after terminal.

When a transport disconnects before terminal, request the next bounded retry:

```ts
const retry = consumer.nextRetry()
if (retry) {
  await delay(retry.delayMs)
  // reconnect with retry.input / consumer.subscriptionInput()
}
```

The consumer computes retry correctness and timing. The host still owns the
actual timer, subscription handle, error presentation, online/offline policy,
and UI state. Accepted progress resets the retry attempt budget.

## Server-side run ownership

Use one host-long-lived `ConversationRunService` from the hosted entrypoint:

```ts
import { ConversationRunService } from '@roackb2/heddle/hosted'

const runs = new ConversationRunService<ProductRunAddress>({
  addressKey: ({ accountId, sessionId }) => JSON.stringify([accountId, sessionId]),
})
```

Authentication and authorization happen before the host constructs or resolves
the address. Do not treat possession of `runId` as authorization.

The run service remains process-local. Its replay buffer is bounded and does
not promise restart recovery or cross-instance delivery. Add shared routing or
durable delivery only when the deployment explicitly requires that additional
assumption layer.

## What remains host-owned

- start/cancel routes or procedures;
- HTTP/SSE/tRPC/WebSocket adapters;
- authentication, tenancy, CORS, rate limits, and audit;
- engine construction, credentials, tools, and approval policy;
- public activity/result projection;
- product finalization and UI state.

See the [hosted-agent example](../../../examples/sdk/05-hosted-agent/README.md)
for a runnable service → Express/SSE → browser flow. Its browser runner and
Heddle's own CLI/web clients reuse this same consumer implementation.
