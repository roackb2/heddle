# Conversation CLI Runner

This module owns the smallest useful interactive console experience for SDK
users. It is not the Heddle product CLI; it is a starter host for developers who
want a working conversation loop before building their own UI.

## Boundary

`ConversationCliRunnerService` owns:

- creating a persisted conversation engine and session;
- attaching `createConversationTextHost` for streaming/status/result output;
- running a readline loop;
- handling only generic local commands: `/session`, `/help`, `/exit`.

It does not own:

- product-specific commands;
- custom approval UX;
- custom telemetry or trace persistence beyond the default engine behavior;
- rich terminal UI behavior from `src/cli-v2`.

When a host needs custom UI, routing, approvals, or domain commands, use
`createConversationEngine` directly and treat this runner as the migration
example.
