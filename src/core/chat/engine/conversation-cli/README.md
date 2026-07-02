# Conversation CLI Runner

This module owns the smallest useful interactive console experience for SDK
users. It is not the Heddle product CLI; it is a starter host for developers who
want a working conversation loop before building their own UI.

## Boundary

`ConversationCliRunnerService` owns:

- creating a persisted conversation engine and session;
- resuming a caller-selected session;
- running a one-shot prompt when the caller does not want an interactive loop;
- attaching `createConversationTextHost` for streaming/status/result output;
- decorating user prompts before submission;
- running a readline loop;
- handling generic local commands: `/session`, `/help`, `/exit`;
- dispatching caller-supplied local commands such as `/artifacts`;
- exposing turn lifecycle hooks for host telemetry and run-file capture.

It does not own:

- product-specific command behavior;
- custom approval UX;
- custom telemetry or trace persistence beyond the default engine behavior;
- rich terminal UI behavior from `src/cli-v2`.

When a host needs custom UI, routing, approvals, or domain commands, use
`createConversationEngine` directly and treat this runner as the migration
example. If a host only needs prompt decoration, approval policy, turn hooks, or
a few local commands, keep those concerns at this boundary and let the runner
own the generic console loop.
