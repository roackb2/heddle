# Hosted Agent Stack Example

This rung-4 example shows how an application can host a conversational Heddle
agent without making Heddle depend on its deployment or transport stack.

```text
agent-service.ts       account/session scope + engine/session/run lifecycle
        |
        v
http-api.ts            Express start/subscribe/cancel + SSE replay
        |
        v
browser-client.ts      typed fetch/SSE protocol (no React or UI state)
        |
        v
browser-run-example.ts cursor, reconnect/backoff, and terminal policy
```

Every layer is replaceable. `HostedAgentService` is useful without HTTP; the
Express adapter can be replaced by tRPC or another server; the client can be
used from any browser TypeScript application.

When copying the example into another project, import Heddle from
`@roackb2/heddle` and declare `express`, `zod`, and `eventsource-parser` in that
project. They are explicit example-stack choices, not requirements of the
transport-neutral Heddle core.

## 1. Use the transport-neutral service

```bash
yarn example:sdk:hosted-agent "What does this repository do?"
```

The runner starts a real Heddle turn, consumes one activity, disconnects the
subscriber, then reconnects with `afterSequence` and receives the remainder
without restarting the turn. Add `--cancel-demo` to start and cancel a second
run through the same public run handle.

The important embedding pattern is in [`agent-service.ts`](agent-service.ts):

- keep one `ConversationRunService` alive for the host process;
- scope addresses by the authenticated account and durable session ID;
- inject engine and host construction so credentials, storage, approvals, and
  telemetry stay application-owned;
- reuse `engine.sessions.readExisting(...)` before creating a conversation;
- return an accepted run ID immediately and subscribe/cancel it separately;
- use Heddle's canonical sequence/replay buffer rather than adding an event bus.

`example-agent.ts` is only the local composition root. It selects a model,
filesystem state root, inspect-only tool profile, and deny-by-default approval
surface. A production service would usually inject database-backed session and
artifact repositories and resolve credentials from its authenticated account.

## 2. Add an HTTP/SSE API

Start the server with an explicit non-production demo secret:

```bash
HEDDLE_EXAMPLE_BEARER_TOKEN=local-example-secret \
  yarn example:sdk:hosted-api
```

The API contract is:

```text
POST /api/agent/runs
GET  /api/agent/runs/:runId/events?after=<sequence>
POST /api/agent/runs/:runId/cancel
```

The start route returns `202 Accepted` only after Heddle has assigned a stable
run identity. The SSE route uses the canonical run sequence for `id`, accepts
either the explicit `after` query or `Last-Event-ID` (the query wins), respects
response backpressure, and aborts only the subscription when the connection
closes. It never cancels the underlying run implicitly.

This teaching API sends Heddle's authenticated run envelope directly, including
the turn result on the terminal item. If your browser must not receive trace,
artifact, tool-result, or session details, project the terminal into a smaller
application-owned public schema before serialization.

The authentication callback is injected. The runnable adapter deliberately
refuses `NODE_ENV=production`; replace it with your real session/JWT verifier,
then add your own CORS, rate limiting, audit, and tenancy policy.

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

## 3. Consume it from browser TypeScript

With the API still running, use the same token in another terminal:

```bash
HEDDLE_EXAMPLE_BEARER_TOKEN=local-example-secret \
  yarn example:sdk:browser-client "Explain the main architecture."
```

`browser-client.ts` owns URL construction, authentication headers, HTTP error
decoding, standards-compliant incremental SSE parsing, Zod validation, event-ID
validation, and abort propagation. It intentionally does not own retry policy,
messages, tool rendering, React state, or application result handling.

`browser-run-example.ts` is the consuming application. It retains the greatest
received sequence, deliberately disconnects after one activity, reconnects
with bounded exponential backoff, and stops on a result/cancel/error terminal.
Add `--cancel-demo` to exercise explicit cancellation through the HTTP API.

Bearer-auth browser clients use streaming `fetch` because native `EventSource`
cannot attach an `Authorization` header. Cookie-auth applications can use
`EventSource` and let the browser send `Last-Event-ID` on reconnect instead.

## Deliberate limits

- Replay is process-local and bounded; durable final conversation state remains
  in the conversation repository. Multi-process delivery needs shared
  infrastructure chosen by the host.
- The example does not prescribe deployment, database, identity provider,
  product state, UI framework, or tRPC/REST choice.
- The explicit service/API/client code is evidence for future SDK utilities,
  not a promise that Heddle should hide every boundary behind one preset.
