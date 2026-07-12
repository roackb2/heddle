# 04 React UI

Follow this optional final stage when the host wants a minimal working web
product above the stage-02 REST/SSE API. It is a reference application, not a
React package or a required Heddle frontend architecture.

## Assumptions

- Stages 01–03 define the host service, API, public contract, and Heddle remote
  run client.
- The product uses React, Vite, React Query, and a browser that supports
  streaming `fetch`.
- The local example server uses its deliberately non-production bearer token.
- One server process retains active run handles and replay events.

If the product already has a frontend stack, copy the lifecycle ideas into its
existing state/query layer. Do not add React Query, AI Elements, or this visual
design merely to match the example.

## Run it

Start the API:

```bash
HEDDLE_EXAMPLE_BEARER_TOKEN=local-example-secret \
  yarn example:sdk:hosted-api
```

Then start the UI in another terminal:

```bash
VITE_HEDDLE_EXAMPLE_BEARER_TOKEN=local-example-secret \
  yarn example:sdk:react-ui
```

Open `http://127.0.0.1:5175`. Vite proxies `/api/agent` to the local API, so the
example does not require permissive CORS. The `VITE_` token is visible to the
browser and is acceptable only for this server's guarded local demo adapter.
Production authentication remains host-owned.

## Read in this order

1. [`hosted-agent-ui-client.ts`](src/hosted-agent-ui-client.ts) — composes
   Heddle's reusable run transport with host-specific conversation read/reset
   endpoints; it shows why those product operations do not belong in the run
   client.
2. [`run-checkpoint.ts`](src/run-checkpoint.ts) — validates the browser-owned
   replay cursor plus its already-rendered projection. Storage failure is
   visible but does not stop the live run.
3. [`use-hosted-conversation.ts`](src/use-hosted-conversation.ts) — React Query
   server state, accepted-run handoff, ordered event consumption, bounded
   reconnect, terminal refresh, stop, second turn, and reset.
4. [`components/`](src/components/) — accessible rendering and controls. The
   two `ai-elements` files are trimmed installed sources from the official AI
   Elements registry; generated Markdown is not rendered as raw text. Optional
   syntax-highlighting, math, Mermaid, and CJK plugins are omitted to keep this
   lifecycle example small and can be added through `MessageResponse` later.
5. [`App.tsx`](src/App.tsx) — composition only: session identity, status,
   conversation, activity, composer, and host-boundary reminder.

## What to verify in the browser

1. Send a first prompt and see the user message immediately.
2. Watch assistant text and safe tool/lifecycle summaries stream separately.
3. Reload while the run is active. The server returns the active `runId`; the
   browser restores its validated cursor and visible projection, then resumes.
4. Stop a run and observe the cancelled terminal without losing the session.
5. Send a second prompt and confirm it continues the same persisted session.
6. Reset only while idle; the accessible confirmation clears server messages
   and local recovery state together.

## Responsibility boundary

Heddle owns the engine session, run identity, replay, cancellation,
result-terminal semantics, protocol validation, cursor ordering, and HTTP/SSE
mechanics. The example host owns authenticated session access, public field
allowlists, its session snapshot/reset API, browser storage choice, retry/error
presentation, optimistic messages, Markdown/UI components, and deployment.

The checkpoint stores both `afterSequence` and the already-rendered assistant
text/activity projection. Restoring only a cursor after a page reload would
skip accepted events without reconstructing what the user had already seen.
Production hosts may put this projection in another client store, but the
cursor and rendered state must advance atomically.

## Deliberate limits

- The UI does not invent approval, billing, auth, or rate-limit policy.
- The local token and process-local replay are not production deployment
  choices.
- The public activity schema exposes safe status fields, not tool inputs,
  results, filesystem paths, traces, or internal session records.
- Cross-process routing and durable event delivery remain host infrastructure.
