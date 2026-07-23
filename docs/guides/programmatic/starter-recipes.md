# Starter Recipes

Use this page when you want the smallest copyable Heddle shape for the host you
already have. These are transparent recipes, not generated application
frameworks: every selected assumption and every product-owned TODO remains
visible in source.

| Starting point | Copy or import | Choose now | Defer safely |
| --- | --- | --- | --- |
| In-process product or script | `ConversationAgentService` | Stable conversation ID and system context | Server framework, transport, database, and UI |
| Server, worker, or desktop backend | [`05-hosted-agent/01-hosted-service`](../../../examples/sdk/05-hosted-agent/01-hosted-service/) | Trusted identity scope and process lifetime | HTTP framework and browser client |
| Existing Express + REST/SSE host | [`05-hosted-agent/02-http-sse-api`](../../../examples/sdk/05-hosted-agent/02-http-sse-api/) | Authentication, public schemas, limits, and deployment | Product UI |

If your product already uses tRPC, Fastify, Hono, Nest, WebSocket, Electron IPC,
or a queue, use the hosted-service recipe and adapt its four lifecycle
operations in the existing stack. Do not add Express merely because the
reference uses it.

## Recipe 1: headless and in process

```ts
import { ConversationAgentService } from '@roackb2/heddle'

const agent = new ConversationAgentService({
  session: {
    id: trustedProductConversationId,
    name: 'Product assistant',
  },
  systemContext: 'Help the user operate this product.',
})

try {
  const result = await agent.send({ prompt: userPrompt })
  renderTrustedResult(result)
} finally {
  await agent.close()
}
```

This starts with local file-backed conversation state under `.heddle`; it does
not require a database or web framework. The host owns where `userPrompt` came
from and how the trusted result is rendered. Do not serialize `result` or its
activities directly to an untrusted client. Long-running hosts may reuse the
service across turns, but must await `close()` during application shutdown.

Before shipping this shape, decide:

- how the stable product conversation ID is derived and authorized;
- which model credentials and product tools the process may use;
- whether the local state root has the backup and restore behavior users were
  promised;
- which canonical product transaction, if any, must commit before success is
  shown.

## Recipe 2: hosted but transport neutral

Copy these files from the hosted reference and rename their product-facing
types to match your domain:

1. [`agent-service.ts`](../../../examples/sdk/05-hosted-agent/01-hosted-service/agent-service.ts)
   for authenticated address scope, session ensure, public conversation
   projection, and run ownership;
2. [`example-agent.ts`](../../../examples/sdk/05-hosted-agent/01-hosted-service/example-agent.ts)
   as a composition-root example for engine, repositories, tools, and policy.

Keep one `ConversationRunService`-backed application service alive for the host
process. It owns process-local run identity, ordered replay, cancellation, and
approval settlement. It does not make active execution durable across process
replacement or replicas.

Replace every example assumption before shipping:

- verify authentication before calling the service and derive account scope
  server-side;
- construct both conversation repositories from that same trusted scope;
- choose a stable product conversation ID instead of accepting an arbitrary
  browser value;
- persist or reconcile the host-owned canonical result in `projectResult`
  before Heddle publishes terminal success;
- decide process draining and run routing explicitly.

## Recipe 3: HTTP and SSE

Only choose this recipe when the host already wants REST plus SSE. Copy the
stage-02 files in this order:

1. [`contracts.ts`](../../../examples/sdk/05-hosted-agent/02-http-sse-api/contracts.ts)
   for runtime-validated public payloads;
2. [`http-api.ts`](../../../examples/sdk/05-hosted-agent/02-http-sse-api/http-api.ts)
   for host routes composed with Heddle's SSE cursor, framing, backpressure,
   and disconnect behavior;
3. [`server.ts`](../../../examples/sdk/05-hosted-agent/02-http-sse-api/server.ts)
   only as a local composition example.

Replace the demo bearer adapter with the product's identity provider. Keep
authorization, request limits, CORS, public error policy, rate limiting, and
deployment in the host. Subscriber disconnect must stop only that subscription;
explicit cancellation is the operation that stops a run.

## Small readiness check

Before handing any recipe to users, verify only the risks implied by the chosen
layer:

- second turn reuses the same Heddle session;
- the authenticated scope cannot read or control another scope;
- the selected session/archive backend behaves correctly after the replacement
  boundary you promise (refresh, process, or replica);
- a hosted subscriber can reconnect without restarting or duplicating the run;
- host-owned canonical results commit before terminal success.

This is integration evidence, not a general certification suite. Add more
checks only when a maintained adapter or product promise introduces a concrete
portable risk.
