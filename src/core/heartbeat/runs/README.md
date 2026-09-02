# Heartbeat Runs

`HeartbeatRunService` owns the process-local lifecycle for one explicitly
requested `HeartbeatRunnerAgent` execution.

It turns the runner's callback events and result promise into one cancellable
handle with ordered activity and exactly one result, cancellation, or safe
error terminal. Stream payloads are projected through JSON serialization so
optional `undefined` fields cannot break a durable store or wire contract.
Hosts can stream that handle without implementing their own buffer, sequence
counter, cancellation controller, serialization shim, or terminal state
machine.

An optional per-run `projectResult` function is the host's awaited boundary
between the internal agent result and the canonical result exposed by the
handle and stream. A host may use it to durably commit or reconcile generic
execution-owned state, then return the public result. Heddle does not publish
the result terminal or resolve the handle promise until projection completes.
Projection failure produces the standard safe error terminal, while
cancellation remains authoritative if it races projection.

```ts
const run = heartbeatRuns.start({
  task: 'Review the current situation and take useful action.',
  projectResult: async (result, { signal }) => {
    signal.throwIfAborted();
    await executionState.commit(result);
    return result;
  },
});
```

The service does not schedule tasks, persist checkpoints or task state, select
models and tools, prepare MCP access, or know about AgentCore and HTTP. Those
responsibilities remain with the heartbeat scheduler, persistence adapter, and
deploying host respectively.
