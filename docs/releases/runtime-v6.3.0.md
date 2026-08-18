# `@heddleagent/runtime` 6.3.0

This release adds `HeartbeatRunService` for hosts that execute one explicit
heartbeat cycle and need a cancellable ordered stream rather than the runner's
callback-and-promise interface.

The service owns:

- process-local heartbeat run identity;
- callback-to-`AsyncIterable` activity delivery;
- cancellation propagation;
- ordered stream envelopes; and
- exactly one result, cancellation, or safe error terminal.

The service deliberately does not schedule or claim tasks, persist checkpoints
or run history, choose models and tools, prepare MCP access, or know about
AgentCore and HTTP. Those responsibilities remain with the scheduler,
persistence adapter, and deploying host.
