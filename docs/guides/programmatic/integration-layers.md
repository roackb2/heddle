# Choose a Programmatic Integration Layer

Heddle's curated SDK assumes a Node.js 20+ TypeScript host that wants to build a
conversational agent experience. It intentionally does not assume how that host
is deployed, which server framework it uses, how events are transported, or
which client renders the conversation.

Use this guide before copying an example. The goal is to adopt the lowest layer
that does the needed heavy lifting while leaving existing product architecture
in control.

## Mental model

```text
HOST-OWNED PRODUCT
  UI state and rendering
          |
  @roackb2/heddle/remote consumer + public contract
          |
  transport client/server adapter                  optional
          |
  application service and composition root
  (product session IDs, tools, config, repositories, policy)
======================== HEDDLE SDK BOUNDARY ========================
  ConversationRunService
  (active run ID, ordered events, bounded replay, cancel, approvals)
          |
  ConversationEngine
  (persisted sessions, turns, compaction, traces, artifacts)
          |
  agent loop, models, tools, host extensions, MCP
```

The application service above the boundary is host code. The
[`HostedAgentService`](../../../examples/sdk/05-hosted-agent/01-hosted-service/agent-service.ts)
example shows one useful shape, but it is not a required Heddle wrapper and is
not transport infrastructure.

## Responsibility boundary

| Concern | Heddle owns | Host owns |
| --- | --- | --- |
| Conversation semantics | Messages, turns, continuation, compaction, leases, and persisted session behavior | Stable product conversation ID and access policy |
| Agent execution | Model/tool loop, tool registry/execution, host-extension composition, traces, and artifacts | Product tools, system context, model choice, credentials, and capability policy |
| Approvals | Approval request/resolution lifecycle and run integration | Whether an action is allowed, authenticated approver, and approval UI/policy |
| Active runs | Run ID, ordered sequence, process-local replay, subscription, cancellation, and terminal result | Lifetime of the run service, address scope, process routing, draining, and multi-process delivery |
| Remote consumption | Cursor advancement, duplicate suppression, sequence-gap failure, terminal detection, bounded reconnect timing, and runtime envelope validation | Public activity/result schemas, actual transport timer/handle, and error UX |
| Persistence | File-backed defaults plus injectable session/artifact repository ports | Production repository implementations, retention, encryption, backup, and tenancy |
| Identity and authorization | No identity-provider assumption | Authentication, tenant/user mapping, authorization for start/subscribe/cancel |
| Transport/API | No HTTP, tRPC, SSE, or WebSocket assumption | Framework, routes/procedures, wire schemas, errors, limits, CORS, and rate limiting |
| Client experience | Semantic activities, terminal run events, and remote cursor/retry calculations | Messages, tool rendering, UI state, transport timers, retry UX, notifications, and product-specific result presentation |

Do not rebuild Heddle-owned conversation or run behavior in the host. In
particular, avoid replaying product chat history into every prompt, generating a
second run ID, adding another in-process event bus, or treating subscriber
disconnect as implicit cancellation.

## Choose by host assumptions

| What the host already has | Heddle entrypoint | Example to follow |
| --- | --- | --- |
| Nothing beyond a TypeScript process | `runQuickstartConversationCli` | [`01-interactive-chat.ts`](../../../examples/sdk/01-interactive-chat.ts) |
| A local loop that needs product tools or MCP | Quickstart plus tools/host extensions | [`02-add-a-tool.ts`](../../../examples/sdk/02-add-a-tool.ts), [`03-add-an-mcp-server.ts`](../../../examples/sdk/03-add-an-mcp-server.ts) |
| Its own output sink or local UI | `createConversationEngine` + `createConversationTextHost` or host callbacks | [`04-custom-output.ts`](../../../examples/sdk/04-custom-output.ts) |
| A server/worker that owns transport | `@roackb2/heddle` + `@roackb2/heddle/hosted` | [`05-hosted-agent/01-hosted-service`](../../../examples/sdk/05-hosted-agent/01-hosted-service) |
| Express with REST + SSE | Same core plus a host adapter | [`05-hosted-agent/02-http-sse-api`](../../../examples/sdk/05-hosted-agent/02-http-sse-api) |
| A remote client over any transport | `@roackb2/heddle/remote` plus a host transport | [Remote conversation runs](remote-runs.md) |
| A browser using the example REST/SSE contract | Remote layer plus the example protocol client | [`05-hosted-agent/03-browser-client`](../../../examples/sdk/05-hosted-agent/03-browser-client) |

For tRPC, Fastify, Hono, Nest, WebSocket, Electron IPC, queues, or another
transport, stop at the hosted-service layer and implement the adapter in the
host's existing framework. Preserve the run lifecycle contract—start,
sequence-based subscribe/replay, explicit cancel, and a terminal event—without
copying Express-specific code.

## Layer-by-layer assumptions

### Quickstart runner

Use `runQuickstartConversationCli` when Heddle may own the prompt loop and
plain-text terminal experience. The host supplies configuration and optional
capabilities. Move deeper when the product needs its own presentation or
lifecycle.

### Conversation engine

Use `createConversationEngine` when the host owns presentation, commands,
approval UI, or session browsing. Heddle still owns the durable conversation
model. Call `engine.turns.submit(...)` for an in-process turn.

### Run service

Add one host-long-lived `ConversationRunService` when request and subscription
lifetimes differ, clients can reconnect, or a turn needs a separately
addressable cancel/approval lifecycle. It is a process-local coordinator above
the engine, not a transport or durable message broker.

Import it from `@roackb2/heddle/hosted` so the hosted-process assumption is
visible. The root export remains available for compatibility.

### Remote run protocol

Use `ConversationRunProtocolCodec` and `ConversationRunConsumerService` from
`@roackb2/heddle/remote` when events cross an untrusted transport boundary or a
client can reconnect. The host supplies public activity/result schemas; Heddle
owns envelope validation, JSON safety, cursor advancement, duplicate/gap
handling, terminal detection, and retry calculation.

This layer does not own HTTP, SSE, tRPC, timers, auth, or UI state. See
[Remote conversation runs](remote-runs.md).

### Transport adapter

Add a host-owned adapter when a remote client needs start, subscribe, cancel, or
approval operations. Validate all untrusted wire data and project internal run
results into an explicitly public schema. Authentication and authorization must
happen before resolving the Heddle run address.

Web-standard HTTP/SSE helpers are a planned higher assumption layer; Express
and tRPC remain framework recipes until their residual code proves a meaningful
adapter boundary.

### Client protocol and UI

Add a transport client only when it matches the host's API. Keep protocol
parsing, cursors, and abort propagation below product UI state. Keep messages,
tool rendering, retry UX, and product result handling in the application's
normal client architecture.

## Extension points

| Requirement | Extend here |
| --- | --- |
| Domain actions or data access | `ToolDefinition`, toolkits, or host extensions |
| MCP-backed capabilities | `prepareMcpHostExtension` |
| Prompt/system behavior | Engine `systemContext`, turn prompt formatting, or host extensions |
| Model and credentials | Host composition root / `createConversationEngine` config |
| Approval behavior | `ConversationEngineHost.approvals` and the product's policy/UI |
| Session/artifact storage | `ChatSessionRepository` and `ArtifactRepository` |
| Public API fields | Host-owned validation schemas and terminal-result projection |
| Remote cursor/retry correctness | `ConversationRunConsumerService` |
| Runtime run-envelope validation | `ConversationRunProtocolCodec` with host activity/result schemas |
| REST, tRPC, SSE, WebSocket, or IPC | Host transport adapter above the application service |
| React or other UI state | Product client/application layer above the protocol client |
| Multi-process live delivery | Host-selected shared routing/broker infrastructure |

## Instructions for coding agents

Before implementation, discover and state:

1. the host's server framework and transport;
2. how identity and tenancy are authenticated;
3. how product conversation IDs are persisted;
4. which UI/state layer consumes run events;
5. whether one process owns a run for its lifetime;
6. which repositories, approval policy, tools, and telemetry are production
   requirements.

Then select the lowest matching layer, copy only the relevant example stages,
and preserve the dependency direction shown above. Prefer adapting the host's
existing framework over installing the sample stack. Do not move transport,
auth, or UI decisions into Heddle core.

Before handoff, verify at minimum:

- a second turn reuses the same durable Heddle session;
- disconnecting one subscriber does not cancel the run;
- reconnecting after sequence N does not restart the turn or duplicate earlier
  events;
- a different authenticated scope cannot subscribe to or cancel the run;
- explicit cancellation reaches a terminal cancelled event;
- only intended public result fields cross the transport boundary.

Continue with the [programmatic guide index](README.md) for API details or the
[numbered SDK examples](../../../examples/sdk/README.md) for runnable code.
