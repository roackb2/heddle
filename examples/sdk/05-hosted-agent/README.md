# Hosted Agent Stack Example

This is stage 05 of the [SDK example ladder](../README.md). It shows how a
TypeScript application can host a reconnectable conversational Heddle agent
without making Heddle depend on the application's server, transport, auth, or
UI stack.

Read [Choose a Programmatic Integration Layer](../../../docs/guides/programmatic/integration-layers.md)
for the canonical ownership model. This README maps that model to runnable
files.

## What this example assumes

- The product wants Heddle to own conversation and run semantics.
- The host owns authenticated account identity and durable product session IDs.
- A single Node.js process can own active runs and bounded replay for this
  example.
- The optional API uses Express, JSON requests, bearer authentication, and SSE.
- The optional client uses browser-compatible streaming `fetch`; it does not
  assume React or another UI framework.

Only the first two assumptions are fundamental to the hosted-service pattern.
Express, SSE, bearer auth, and the sample browser client are replaceable host
choices.

When copying this example into another project, replace the relative source
imports with `@roackb2/heddle`, `@roackb2/heddle/hosted`, and
`@roackb2/heddle/remote` as shown by each layer. Stage 01 requires Heddle only;
stage 02 additionally uses `express`, its TypeScript types, and `zod`; stage 03
uses `eventsource-parser` and the shared Zod wire contracts. Declare those
libraries directly in the host project instead of relying on transitive
dependencies.

## Choose the layers that match your stack

| Host stack | Follow | Skip or replace |
| --- | --- | --- |
| Node process, worker, Electron backend, or no remote client | `01-hosted-service` | Skip stages 02 and 03 |
| Existing tRPC, Fastify, Hono, Nest, WebSocket, or framework-specific server | `01-hosted-service`, then adapt stage 02's lifecycle rules | Replace the Express router and wire schemas |
| Express + REST/SSE server | `01-hosted-service` → `02-http-sse-api` | Replace only demo auth, storage, and deployment policy |
| Browser using this exact REST/SSE protocol | All three stages | Add product UI state and rendering above stage 03 |
| Multi-process or serverless deployment | Use stage 01 as the application boundary | Replace process-local replay/routing with host-chosen shared infrastructure |

## Read the files in this order

```text
05-hosted-agent/
  01-hosted-service/
    agent-service.ts       host scope + engine/session/run lifecycle
    example-agent.ts       runnable composition root and demo policy
    run.ts                 in-process disconnect/replay/cancel demo
             |
             v
  02-http-sse-api/
    contracts.ts           public schemas + Heddle remote protocol codec
    http-api.ts            Express start/subscribe/cancel + SSE adapter
    server.ts              runnable local server and demo authentication
             |
             v
  03-browser-client/
    browser-client.ts      typed fetch/SSE protocol adapter
    run.ts                 public consumer + transport reconnect demo
```

The dependency direction is intentional:

- stage 01 imports Heddle and has no HTTP or browser dependency;
- stage 02 imports stage 01 and translates it into one chosen wire protocol;
- stage 03 imports stage 02's public contract and knows nothing about Heddle
  internals.

Do not reverse these imports when adapting the example. A transport-neutral
agent service should never read an HTTP request, and Heddle core should never
know which client framework renders the result.

## 01 Hosted service: Heddle engine, host lifecycle

Run it without a server:

```bash
yarn example:sdk:hosted-agent "What does this repository do?"
```

The runner starts a real Heddle turn, consumes one activity, disconnects the
subscriber, then reconnects with `afterSequence` and receives the remainder
without restarting the turn. Add `--cancel-demo` to start and cancel a second
run through the same public run handle.

### What it showcases

[`agent-service.ts`](01-hosted-service/agent-service.ts) is application code
that composes Heddle's `ConversationRunService`; it is not another Heddle core
service or a required SDK wrapper. It demonstrates how a host can:

- keep one run service alive for the host process;
- scope run addresses by authenticated account and durable session ID;
- inject engine and host construction so credentials, storage, approvals, and
  telemetry stay application-owned;
- reuse `engine.sessions.readExisting(...)` before creating a conversation;
- return an accepted run ID immediately, then subscribe or cancel separately;
- use Heddle's canonical ordered replay instead of adding a second event bus.

### Responsibility boundary

Heddle owns persisted messages, compaction, model/tool execution, traces,
artifacts, run identity, ordered activities, bounded replay, and cancellation.
The host owns account-to-scope mapping, durable session IDs, engine
configuration, injected repositories, approval decisions, and process
lifecycle.

[`example-agent.ts`](01-hosted-service/example-agent.ts) is the local
composition root. It chooses a model, filesystem state root, inspect-only tool
profile, and deny-by-default approval callback. In a production host, replace
those choices with authenticated credential resolution, product tools,
production repositories, approval policy/UI, and telemetry.

### How to adapt it

- Keep `HostedAgentService` in the host's application/service layer.
- Replace `accountId` with the host's authenticated tenant or user scope; never
  trust a client-supplied account ID.
- Use a stable product conversation ID for `sessionId` so later turns reuse the
  same Heddle conversation.
- Inject database-backed `ChatSessionRepository` and `ArtifactRepository`
  implementations when local files are not suitable.
- Keep one active-run owner for each address. Decide explicitly how requests
  route to that owner in a multi-process deployment.

## 02 HTTP/SSE API: host-owned transport

Start the server with an explicit non-production demo secret:

```bash
HEDDLE_EXAMPLE_BEARER_TOKEN=local-example-secret \
  yarn example:sdk:hosted-api
```

The sample contract is:

```text
POST /api/agent/runs
GET  /api/agent/runs/:runId/events?after=<sequence>
POST /api/agent/runs/:runId/cancel
```

### What it showcases

[`contracts.ts`](02-http-sse-api/contracts.ts) validates untrusted wire data and
defines the public browser contract through Heddle's
`ConversationRunProtocolCodec`. [`http-api.ts`](02-http-sse-api/http-api.ts)
adapts HTTP operations to the transport-neutral service:

- start returns `202 Accepted` after Heddle assigns a stable run identity;
- subscribe uses each canonical run sequence as the SSE `id`;
- reconnect accepts either `after` or `Last-Event-ID`, with the explicit query
  taking precedence;
- response backpressure is respected;
- closing an SSE connection aborts only that subscription, not the run;
- cancel is a separate, authenticated operation.

The API deliberately projects terminal results to public `outcome` and
`summary` fields. Trace paths, artifacts, tool results, and internal session
state are not serialized to the browser. Extend the public Zod schema with only
the product data the client is authorized to receive.

### Responsibility boundary

Heddle still owns the conversation and active run. The host owns authentication,
authorization, request limits, public schemas, HTTP status/error policy, CORS,
rate limiting, audit, deployment, and transport observability.

[`server.ts`](02-http-sse-api/server.ts) deliberately refuses
`NODE_ENV=production`; its fixed demo token is not a production auth design.
Replace the injected `authenticate` callback with the host's session or JWT
verification and derive `accountId` from that verified principal.

### Other server stacks

For tRPC, expose start/cancel as mutations and run events as a subscription or
stream while preserving `runId`, sequence, terminal events, explicit cancel,
and subscriber-only disconnect semantics. For Fastify, Hono, Nest, WebSocket,
or another stack, apply the same lifecycle contract in that framework rather
than wrapping this Express router.

Start a run manually:

```bash
curl -i http://127.0.0.1:8787/api/agent/runs \
  -H 'authorization: Bearer local-example-secret' \
  -H 'content-type: application/json' \
  -d '{"sessionId":"curl-example","prompt":"Summarize this repository."}'
```

Use the returned `runId` to subscribe, resume, or cancel:

```bash
curl -N http://127.0.0.1:8787/api/agent/runs/RUN_ID/events?after=0 \
  -H 'authorization: Bearer local-example-secret'

curl -X POST http://127.0.0.1:8787/api/agent/runs/RUN_ID/cancel \
  -H 'authorization: Bearer local-example-secret'
```

## 03 Browser client: protocol, not product UI

With the API running, use the same token in another terminal:

```bash
HEDDLE_EXAMPLE_BEARER_TOKEN=local-example-secret \
  yarn example:sdk:browser-client "Explain the main architecture."
```

### What it showcases

[`browser-client.ts`](03-browser-client/browser-client.ts) owns URL
construction, authentication headers, HTTP error decoding, incremental SSE
parsing with `eventsource-parser`, Zod validation, event-ID validation, and
abort propagation.

[`run.ts`](03-browser-client/run.ts) is the consuming application policy. It
uses Heddle's `ConversationRunConsumerService` for cursor advancement,
duplicate/gap handling, terminal detection, and bounded reconnect timing. The
runner deliberately disconnects after one activity while retaining ownership
of the actual timer and transport lifecycle. Add `--cancel-demo` to exercise
explicit cancellation.

### Responsibility boundary

The protocol client does not own chat messages, tool-call presentation, React
state, optimistic updates, retry UI, notifications, or application result
handling. Put those concerns in the product's existing client/application
layer. If the host uses React Query, a state machine, or another mature client
library, wrap `start`, `subscribe`, and `cancel` there instead of adding UI state
to this transport client.

Bearer-auth browser clients use streaming `fetch` because native `EventSource`
cannot attach an `Authorization` header. Cookie-auth applications can use
`EventSource` and let the browser send `Last-Event-ID` on reconnect.

## Production adaptation checklist

A coding agent adapting this example should report how the host handles each
item before calling the integration production-ready:

- authenticated scope and authorization for start, subscribe, and cancel;
- stable product conversation IDs and tenant isolation;
- model credential resolution and product-owned tools/system context;
- approval policy and user-facing approval resolution;
- durable session and artifact repositories;
- request validation, payload limits, CORS, rate limiting, and audit;
- reconnect cursor persistence and duplicate-safe client event handling;
- process ownership, draining, and cross-process run routing;
- public terminal-result projection and sensitive-data review;
- traces, metrics, failure reporting, and cancellation verification.

## Deliberate limits

- Replay and active run handles are process-local and bounded. Durable final
  conversation state remains in the conversation repository. Multi-process
  delivery needs shared infrastructure chosen by the host.
- The example does not prescribe deployment, database, identity provider,
  product state, UI framework, or tRPC/REST/WebSocket choice.
- The explicit service/API/client code is evidence for future SDK utilities,
  not a promise that Heddle should hide every boundary behind one preset.
