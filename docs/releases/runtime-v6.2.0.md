# `@heddleagent/runtime` 6.2.0

This release adds an optional provider-neutral execution port for one heartbeat
agent cycle. A long-running scheduler can keep durable task authority, claims,
checkpoints, settlement, history, and recovery in its own process while a
separate execution process runs only the nested agent loop.

The existing local `HeartbeatRunnerAgent` remains the default when no transport
is supplied. Results returned across the transport are runtime-validated before
the scheduler persists a checkpoint or successful settlement.

## What changed

- add `HeartbeatAgentExecutionTransport` to the public heartbeat scheduler;
- project only bounded task, checkpoint, run-context, and runtime preference
  fields across the execution boundary;
- keep credentials, tools, approval callbacks, filesystem paths, model
  adapters, and PostgreSQL access inside their owning process;
- expose remote agent activity through the existing scheduler event channel;
  and
- preserve claim fencing, cancellation, checkpoint, and settlement semantics
  in the coordinator.

This is an execution seam, not a queue, workflow engine, storage adapter, or
hosted control plane.
