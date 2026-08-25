# Execution Host Client v6.6.0

`@heddleagent/execution-host-client@6.6.0` removes more repeated integration
work from products and compatible Execution Host implementations. The package
now owns the complete reusable client, provider configuration, and
provider-neutral Runtime-session boundaries needed by the hosted vertical.

## What changed

- add the browser-safe `/adopter` conversation client with bounded public
  errors, strict ordered SSE validation, identity binding, and truthful terminal
  settlement;
- complete the `/coordinator` client with coordinator state, task inspection,
  task triggering, pause, resume, and drain operations;
- add canonical AgentCore region, Runtime ARN, and qualifier schemas and
  validate every `AgentCoreExecutionHost` at construction; and
- add the `/host` Runtime-session service for immutable scope binding,
  one-active-invocation admission, workflow dispatch, deadlines, cancellation,
  bounded duplicate suppression, status, and shutdown.

## Ownership boundary

Products retain authentication, authorization, desired task data, credentials,
MCP behavior, product persistence, and UI. Deployable Execution Hosts retain
provider ingress, isolation, engine composition, health projection, bootstrap,
and deployment. Consumers should import these public services and vocabulary
directly rather than copying or renaming them.

## Publication

Publish manually from the tagged release commit. This repository does not
automatically publish packages from `main`.
