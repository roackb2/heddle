# Conversation CLI Runner

This module owns the smallest useful interactive console experience for SDK
users. It is not the Heddle product CLI; it is a starter host for developers who
want a working conversation loop before building their own UI.

## Boundary

`ConversationCliRunnerService` owns:

- creating a persisted conversation engine and session;
- resolving generic SDK defaults for workspace root, state root, model, and
  memory maintenance mode;
- resolving model credentials before a session starts;
- printing default model and credential status;
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
- product-specific environment variable names beyond accepting already-resolved
  overrides;
- custom approval UX;
- product-specific auth instructions beyond an optional missing-credential hint;
- custom telemetry or trace persistence beyond the default engine behavior;
- rich terminal UI behavior from `src/cli-v2`.

## Defaults

`resolveConversationCliDefaults` is the public way to ask the runner for the
same concrete defaults it will use internally. Call it when host code needs a
resolved `stateRoot` or model before `runConversationCli` starts, for example
when preparing host extensions.

The default model order is:

1. `options.model`
2. `HEDDLE_MODEL`
3. `HEDDLE_EXAMPLE_MODEL`
4. `OPENAI_MODEL`
5. `ANTHROPIC_MODEL`
6. Heddle's built-in OpenAI default

The runner defaults memory maintenance to `none` and leaves `maxSteps`
unset. Hosts that need background maintenance or a hard turn budget should
override those values once at this boundary.

When a host needs custom UI, routing, approvals, or domain commands, use
`createConversationEngine` directly and treat this runner as the migration
example. If a host only needs prompt decoration, approval policy, turn hooks, or
a few local commands, keep those concerns at this boundary and let the runner
own the generic console loop.
