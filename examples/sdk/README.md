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
- A configured model credential supported by Heddle.
- In this repository, run `yarn install` before the example scripts.
- In another project, install `@roackb2/heddle` and only the libraries used by
  the host stack you choose.

The SDK assumes that you want to build a conversational agent in TypeScript. It
does **not** assume Express, tRPC, HTTP, SSE, WebSocket, React, a deployment
platform, an identity provider, or a database.

## Choose where to start

| Your current host | Start with | New host responsibility |
| --- | --- | --- |
| No agent loop or UI yet | [`01-interactive-chat.ts`](01-interactive-chat.ts) | Configuration and prompts only |
| A local chat that needs product capabilities | [`02-add-a-tool.ts`](02-add-a-tool.ts) or [`03-add-an-mcp-server.ts`](03-add-an-mcp-server.ts) | Tool implementation or MCP server selection |
| A process that already owns output/rendering | [`04-custom-output.ts`](04-custom-output.ts) | Output sink and presentation policy |
| A server, worker, Electron backend, or custom transport | [`05-hosted-agent/01-hosted-service`](05-hosted-agent/01-hosted-service) | Identity scope, durable session IDs, engine composition, and process lifetime |
| An Express server using REST + SSE | [`05-hosted-agent/02-http-sse-api`](05-hosted-agent/02-http-sse-api) | Authentication, routes/API policy, CORS/limits, and deployment |
| A browser consuming that REST + SSE contract | [`05-hosted-agent/03-browser-client`](05-hosted-agent/03-browser-client) | Auth headers, abort/timer lifecycle, UI state, retry UX, and product result handling |
| A React/Vite product needing a complete reference | [`05-hosted-agent/04-react-ui`](05-hosted-agent/04-react-ui) | Session API, browser storage, UI state/rendering, auth, and deployment policy |

If your server already uses tRPC, Fastify, Hono, Nest, WebSocket, or another
transport, follow the hosted-service stage and write an adapter for that stack.
Do not introduce Express merely to copy the example.

## Follow the customization ladder

### 01 Interactive Chat — working conversation

```bash
yarn example:sdk:interactive
```

**Assumption:** Heddle can own the local prompt loop, persisted session, and
plain-text output. This is the smallest file to copy for an SDK evaluation.

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
