# Programmatic Hosts

Heddle exports runtime building blocks for applications that want to build an
agentic experience without shelling out to the CLI. The main path is the
conversation engine: it owns durable sessions, turn execution, compaction,
traces, artifacts, default tools, host extensions, and approval callbacks.

Use these docs by task:

- [Quickstart](quickstart.md): a minimal persisted conversation with default
  text output.
- [Conversation engine](conversation-engine.md): engine setup, state roots, and
  persisted sessions.
- [Text host](text-host.md): default console-style output and custom text
  destinations.
- [Host extensions](host-extensions.md): add generic product or domain tools.
- [MCP host extensions](mcp-host-extensions.md): expose MCP servers as curated
  Heddle tools without copying schemas.
- [Result artifacts](result-artifacts.md): save large generated values as
  reusable artifacts.
- [Turn results](turn-results.md): consume trace file, artifacts, and tool-call
  summaries after each turn.
- [Approvals](approvals.md): own policy decisions in the host.

For contributor-facing module boundaries, see
[Core Layering](../../architecture/core-layering.md).
