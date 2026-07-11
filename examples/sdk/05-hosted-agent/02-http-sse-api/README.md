# 02 HTTP/SSE API

Follow this optional stage when the host uses Express and wants a REST/SSE API
over the [transport-neutral hosted service](../01-hosted-service/). See the
[full hosted-agent walkthrough](../README.md#02-httpsse-api-host-owned-transport)
for curl commands, lifecycle details, and production replacements.

## Assumptions

- Stage 01 already owns Heddle conversation/run lifecycle.
- The host chose Express, JSON requests, and SSE as its transport.
- The host will replace demo bearer auth with verified product identity and
  derive account scope server-side.

## Read in this order

1. [`contracts.ts`](contracts.ts) — Zod schemas for untrusted public wire data.
2. [`http-api.ts`](http-api.ts) — authenticated start, cursor subscribe, and
   explicit cancel handlers.
3. [`server.ts`](server.ts) — runnable local composition with deliberately
   non-production auth.

The transport must preserve stable `runId`, ordered `sequence`, replay after a
cursor, subscriber-only disconnect, explicit cancellation, and a terminal
event. If the host uses tRPC, Fastify, Hono, Nest, WebSocket, or another stack,
implement those semantics there and do not copy the Express router.
