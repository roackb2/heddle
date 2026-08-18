# Heartbeat Runs

`HeartbeatRunService` owns the process-local lifecycle for one explicitly
requested `HeartbeatRunnerAgent` execution.

It turns the runner's callback events and result promise into one cancellable
handle with ordered activity and exactly one result, cancellation, or safe
error terminal. Hosts can stream that handle without implementing their own
buffer, sequence counter, cancellation controller, or terminal state machine.

The service does not schedule tasks, persist checkpoints or task state, select
models and tools, prepare MCP access, or know about AgentCore and HTTP. Those
responsibilities remain with the heartbeat scheduler, persistence adapter, and
deploying host respectively.
