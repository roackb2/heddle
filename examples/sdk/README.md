# SDK Examples

These numbered examples form a progressive path from a working local chat to a
hosted, reconnectable conversational agent. Follow them in order when learning
Heddle, or use the chooser below when your product already owns part of the
stack.

Read [Choose a Programmatic Integration Layer](../../docs/guides/programmatic/integration-layers.md)
before adapting the examples into a product. It defines which behavior belongs
to Heddle and which behavior must stay in the host.

## Prerequisites

- Node.js 20 or newer and a TypeScript/ESM project.
- A configured model credential supported by Heddle for examples that execute
  turns. Stage 06 verifies persistence without a model request or API key.
- In this repository, run `yarn install` before the example scripts.
- In another project, install `@roackb2/heddle` and only the libraries used by
  the host stack you choose.

The SDK assumes that you want to build a conversational agent in TypeScript. It
does **not** assume Express, tRPC, HTTP, SSE, WebSocket, React, a deployment
platform, an identity provider, or a database.

## Choose where to start

| Your current host | Start with | New host responsibility |
| --- | --- | --- |
| A TypeScript process that owns input/output | [`01-headless-conversation.ts`](01-headless-conversation.ts) | Configuration and prompts only |
| A terminal evaluation with no host loop | [`01-interactive-chat.ts`](01-interactive-chat.ts) | Configuration and prompts only |
| A local chat that needs product capabilities | [`02-add-a-tool.ts`](02-add-a-tool.ts) or [`03-add-an-mcp-server.ts`](03-add-an-mcp-server.ts) | Tool implementation or MCP server selection |
| A process that already owns output/rendering | [`04-custom-output.ts`](04-custom-output.ts) | Output sink and presentation policy |
| A server, worker, Electron backend, or custom transport | [`05-hosted-agent/01-hosted-service`](05-hosted-agent/01-hosted-service) | Identity scope, durable session IDs, engine composition, and process lifetime |
| An Express server using REST + SSE | [`05-hosted-agent/02-http-sse-api`](05-hosted-agent/02-http-sse-api) | Authentication, routes/API policy, CORS/limits, and deployment |
| A browser consuming that REST + SSE contract | [`05-hosted-agent/03-browser-client`](05-hosted-agent/03-browser-client) | Auth headers, abort/timer lifecycle, UI state, retry UX, and product result handling |
| A React/Vite product needing a complete reference | [`05-hosted-agent/04-react-ui`](05-hosted-agent/04-react-ui) | Session API, browser storage, UI state/rendering, auth, and deployment policy |
| A hosted service that already uses PostgreSQL | [`06-postgres-drizzle-storage`](06-postgres-drizzle-storage) | Migrations, trusted tenant scope, pooling, retention, and database operations |

If your server already uses tRPC, Fastify, Hono, Nest, WebSocket, or another
transport, follow the hosted-service stage and write an adapter for that stack.
Do not introduce Express merely to copy the example.

## Follow the customization ladder

### 01 Headless or Interactive — working conversation

For structured in-process output:

```bash
yarn example:sdk:headless "What does this repository do?"
```

**Assumption:** the host owns input/output while Heddle owns runtime defaults,
stable session ensure, and turn execution. The result contains the normal turn
summary plus ordered structured activities.

For a temporary terminal prompt loop:

```bash
yarn example:sdk:interactive
```

**Assumption:** Heddle can own the local prompt loop, persisted session, and
plain-text output. Both stage-01 paths use the same generic starter defaults.

### 02 Add a Tool — native host capability

```bash
yarn example:sdk:add-tool
```

**Assumption:** the host has a capability that should be model-visible. The host
owns the tool's domain behavior; Heddle owns tool registration, invocation,
approval integration, and trace visibility.

### 03 Add an MCP Server — external capabilities

```bash
yarn example:sdk:add-mcp
```

**Assumption:** the capability already exists behind an MCP server. The host
selects and configures the server; Heddle prepares its tools as a curated host
extension.

Examples 02 and 03 are sibling choices. Use either or both before moving on.

### 04 Custom Output — host-owned presentation

```bash
yarn example:sdk:custom-output
```

**Assumption:** Heddle should still own conversation semantics, while the host
owns where streamed text and status are rendered. Replace the output sink with
a terminal writer, webhook, log collector, or local application surface.

### 05 Hosted Agent — host-owned lifecycle and optional transport

```bash
yarn example:sdk:hosted-agent "What does this repository do?"
```

This directory contains its own numbered path:

1. `01-hosted-service` — transport-neutral account/session/run lifecycle.
2. `02-http-sse-api` — optional Express routes composed with Heddle's Node
   HTTP/SSE streaming helper.
3. `03-browser-client` — optional browser-safe HTTP/SSE preset composed with
   Heddle's transport-neutral remote-run consumer.
4. `04-react-ui` — optional working React/Vite product with server-backed
   messages, reload recovery, stop, second turn, reset, and visible activity.

Read the [hosted-agent walkthrough](05-hosted-agent/README.md) before copying
this stage. Each later folder depends only on the earlier layer it extends, so
a coding agent can replace the host-specific layer without moving transport or
UI concerns into Heddle's conversation core.

### 06 PostgreSQL + Drizzle Storage — durable completed conversations

```bash
docker compose \
  -f examples/sdk/06-postgres-drizzle-storage/compose.yaml \
  up -d --wait
yarn example:postgres-storage:verify
```

**Assumption:** the host already owns a PostgreSQL service and derives a trusted
tenant/account scope from server authentication. The reference implements both
Heddle repository ports as one conversation persistence capability, applies
checked-in migrations, runs the public session conformance suite, and proves
session plus archive recovery through fresh connection pools and engine
instances. The engine readiness report identifies the remaining host-owned
checks. This is deliberately an example rather than an official adapter
package.

Read the [storage reference boundary](06-postgres-drizzle-storage/README.md)
before copying it. This stage can be combined with any stage-05 transport or UI;
database persistence does not require adopting the example HTTP stack.

## Guidance for coding agents

When adapting these examples:

1. Identify the existing server framework, transport, authentication model, UI
   framework, persistence, and deployment topology.
2. Choose the lowest numbered example that already satisfies the product need.
3. Copy only the layers whose assumptions match the host.
4. Preserve dependency direction: UI → transport → application service →
   Heddle run service → Heddle conversation engine.
5. Keep product identity, authorization, public API schemas, UI state, and
   cross-process delivery in the host.
6. Keep conversation history, turn execution, compaction, tool execution,
   traces, artifacts, ordered run events, replay, and cancellation in Heddle.

The [programmatic guide index](../../docs/guides/programmatic/README.md) has the
API-level documentation that corresponds to each example.
