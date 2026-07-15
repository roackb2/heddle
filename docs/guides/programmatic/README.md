# Programmatic Hosts

Heddle is an agent SDK: import it to add an agentic experience to your product
without shelling out to the CLI. The main path is the conversation engine — it
owns durable sessions, turn execution, compaction, traces, artifacts, default
tools, host extensions, and approval callbacks.

These guides follow a **progressive-disclosure ladder**. Start at rung 1 and go
deeper only when you need to. This mirrors how the public API is organized.

The public entry points span two independent axes: customization depth and
hosting assumptions.

- `@roackb2/heddle` — the **curated** default surface (rungs 1–5): everything a
  product host needs to build an agentic experience.
- `@roackb2/heddle/hosted` — process-local run identity, replay, cancellation,
  and approvals for a long-lived host process.
- `@roackb2/heddle/hosted/http-sse` — opt-in Node HTTP/SSE framing,
  backpressure, replay-cursor, and subscriber-disconnect correctness.
- `@roackb2/heddle-remote` — an independently installable, browser-safe package
  with runtime contracts plus transport-neutral cursor, duplicate, gap,
  terminal, and reconnect correctness.
- `@roackb2/heddle-remote/http-sse` — opt-in browser-safe fetch/SSE parsing and
  transport validation for the conventional REST run resource.
- `@roackb2/heddle/advanced` — the **deep core customization** surface: the curated exports plus
  lower-level building blocks (LLM adapters, individual tools, trace, memory,
  models, awareness) and specialized runtimes (agent loop, heartbeat,
  integrations). It does not implicitly opt into remote hosting or a transport.

Before choosing an API, read
[Choose a Programmatic Integration Layer](integration-layers.md). It maps common
host stacks to the smallest useful Heddle boundary and makes the responsibility
split between Heddle and the host explicit for developers and coding agents.

1. **Start here** — stand up a conversation agent.
   - [Quickstart](quickstart.md): a minimal persisted conversation with default
     text output, in a few lines.
2. **Add capabilities** — give the agent your own tools, MCP servers, skills.
   - [Host extensions](host-extensions.md): add generic product or domain tools.
   - [MCP host extensions](mcp-host-extensions.md): expose MCP servers as curated
     Heddle tools without copying schemas.
3. **Shape input/output** — control how activity/text renders and where it goes.
   - [Text host](text-host.md): default console-style output and custom text
     destinations.
   - [Turn results](turn-results.md): consume trace file, artifacts, and
     tool-call summaries after each turn.
4. **Advanced: lifecycle** — own the engine, sessions, and approvals yourself.
   - [Conversation engine](conversation-engine.md): engine setup, state roots,
     and persisted sessions.
   - [Approvals](approvals.md): own policy decisions in the host.
   - [Remote conversation runs](remote-runs.md): consume reconnectable runs
     through any transport with runtime-validated public payloads.
   - [Hosted agent stack](../../../examples/sdk/05-hosted-agent/README.md): compose
     a transport-neutral run service, Express/SSE API, browser client, and
     optional React reference product while keeping each layer replaceable.
5. **Advanced: storage** — back Heddle with your own persistence.
   - [Result artifacts](result-artifacts.md): save large generated values as
     reusable artifacts.
   - Artifact and session storage are injectable: implement
     `ArtifactRepository` / `ChatSessionRepository` and pass them as
     `artifactRepository` / `sessionRepository` (see
     [Conversation engine → Bring your own artifact storage](conversation-engine.md#bring-your-own-artifact-storage)
     and [Durable session storage](session-storage.md) for local JSON and
     PostgreSQL adapter guidance).
     Traces and memory still persist under a local state root; making them
     injectable follows the same pattern.

Runnable versions of the first few rungs live in
[`examples/sdk/`](../../../examples/sdk/README.md).

For contributor-facing module boundaries, see
[Core Layering](../../architecture/core-layering.md).
