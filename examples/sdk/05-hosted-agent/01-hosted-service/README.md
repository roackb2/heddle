# 01 Hosted Service

Start here when a TypeScript server, worker, desktop backend, or other long-lived
process should host a conversational agent without committing to a transport.
See the [full hosted-agent walkthrough](../README.md#01-hosted-service-heddle-engine-host-lifecycle)
for the runnable flow and production checklist.

## Assumptions

- Heddle owns conversation history, turns, tools, traces, artifacts, run events,
  replay, and cancellation.
- The host owns authenticated account scope, stable product conversation IDs,
  engine configuration, repositories, approval policy, and process lifetime.
- Active run handles and replay may live in one process. A distributed host must
  add its own routing/shared-delivery design above this boundary.

## Read in this order

1. [`agent-service.ts`](agent-service.ts) — application-owned scope and lifecycle
   composed over `ConversationRunService` from `@roackb2/heddle/hosted`.
2. [`example-agent.ts`](example-agent.ts) — replaceable local composition and
   demo policy.
3. [`run.ts`](run.ts) — disconnect, cursor replay, and explicit cancellation in
   one process.

Keep this folder free of HTTP request/response types and UI state. If the host
already uses tRPC, Fastify, Hono, Nest, WebSocket, or IPC, adapt this service
directly in that stack. Continue to [02 HTTP/SSE API](../02-http-sse-api/) only
when Express + REST/SSE matches the host.
