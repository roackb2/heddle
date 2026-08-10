# Hosted conversation orchestration

This domain owns the reusable middle of one adopter-initiated conversation
turn: issue short-lived authority, resolve a model credential through a narrow
port, and invoke the provider-neutral `ExecutionHost` stream.

It deliberately does not own:

- end-user authentication or product authorization;
- tenant, subject, session, Runtime-session, or invocation-ID selection;
- which product MCP tools a particular user may receive;
- result persistence, idempotency, retry, billing, or UI projection;
- HTTP routing or AWS transport.

The adopter supplies those decisions, then calls `HostedConversationTurnService`
with already authorized IDs. Configure `mcp.allowedTools` once when every turn
through that service shares the same bounded tool policy. Omit it for an
execution-only workflow.
