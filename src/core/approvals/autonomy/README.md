# Approval Autonomy

This domain owns Heddle's autopilot approval policy semantics.

## Owns

- Normalized autopilot root profiles.
- Agent-declared policy envelope evaluation.
- Runtime-computed autonomy facts.
- Allow/request/deny decisions for unattended tool calls.
- Policy hints that help future sessions tune config after a blocked run.

## Does Not Own

- Tool schema injection or envelope extraction. That belongs to
  `src/core/tools/policy-envelope`.
- Tool execution.
- Pending approval UI or browser/TUI presentation.
- Remembered project approval storage.

## Boundary Rule

The agent's envelope is a claim. The autonomy policy uses it as the declared
scope contract for ambiguous tools, but deterministic hard-deny rules and
configured root policy remain runtime-owned.
