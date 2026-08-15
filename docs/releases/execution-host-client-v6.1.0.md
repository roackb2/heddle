# Execution Host Client v6.1.0

`@heddleagent/execution-host-client@6.1.0` adds Heddle's official AWS
AgentCore transport for invoking a separately deployed compatible Execution
Host.

```bash
npm install @heddleagent/execution-host-client@6.1.0
```

## What changed

- add `@heddleagent/execution-host-client/agentcore`;
- move the production-exercised `AgentCoreExecutionHost` behavior out of the
  Lucid adopter and into the reusable Heddle integration package;
- validate AgentCore Runtime session IDs;
- add Heddle authority headers before SigV4 signing;
- stream AWS response bodies through the existing strict request/SSE client;
- preserve one-attempt behavior for ambiguously interrupted invocations; and
- map bounded AgentCore service failures to safe rejection codes.

The package does not deploy AgentCore Runtime or bind to an AWS account.
Adopters still own account configuration, Runtime provisioning, IAM policy,
region, Runtime ARN, credentials, product authority, persistence, and result
application.

## Publication

Publish manually after the reviewed release commit is merged. This repository
does not automatically publish packages from `main`.
