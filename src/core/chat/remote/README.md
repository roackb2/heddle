# Remote Conversation Runs

This domain owns browser-safe, transport-neutral correctness for consuming a
conversation run across a remote boundary.

## Owns

- selecting one accepted run reference;
- advancing the greatest accepted sequence cursor;
- suppressing replayed duplicates;
- rejecting sequence gaps and post-terminal events;
- recognizing result, cancellation, and error terminals;
- bounded exponential reconnect timing;
- runtime validation of the canonical run envelope and host payloads through
  the validator-neutral Standard Schema interface;
- JSON-safety validation before a transport serializes an event.

## Does not own

- server run coordination or replay storage (`src/core/chat/runs` owns those);
- HTTP, SSE, tRPC, WebSocket, React, or transport handles/timers;
- authentication, authorization, tenant policy, or route design;
- which activity/result fields are safe to expose publicly;
- product messages, tool rendering, finalization, conflict handling, or UI.

## Public usage

Import this layer explicitly so the remote-hosting assumption is visible:

```ts
import {
  ConversationRunConsumerService,
  ConversationRunProtocolCodec,
} from '@roackb2/heddle/remote'

const protocol = new ConversationRunProtocolCodec({
  activity: PublicActivitySchema,
  result: PublicResultSchema,
})

const consumer = new ConversationRunConsumerService({
  retry: { maxAttempts: 6, baseDelayMs: 500, maxDelayMs: 4_000 },
})
```

The host must supply synchronous
[Standard Schema](https://standardschema.dev/schema) validators that expose only
authorized public payloads. Zod 3.24+, Zod 4, Valibot, ArkType, and other
implementations can be used without coupling the SDK to their schema objects.
The codec owns the envelope and JSON safety; it does not sanitize sensitive
product or tool data on the host's behalf.

CLI-v2, web-v2, and SDK examples must reuse this service. Do not add another
cursor/retry state machine in a client adapter.
