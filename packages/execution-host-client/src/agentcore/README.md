# AWS AgentCore Execution Host client

This module is the official AWS AgentCore transport for the public
`ExecutionHost` and `HeartbeatExecutionHost` ports. It sends the versioned invocation contract through
`InvokeAgentRuntime`, adds Heddle authority headers before SigV4 signing, and
delegates strict request/SSE validation to the shared Execution Host client.

It owns:

- canonical Runtime region, ARN, qualifier, and composed-target validation;
- AgentCore Runtime session-ID validation;
- AWS SDK client construction through the default credential chain;
- one-attempt invocation semantics because a disconnected streaming request
  has ambiguous settlement;
- command-scoped, SigV4-signed Heddle authority headers;
- AWS streaming-body conversion; and
- bounded provider-error mapping into Execution Host rejection codes.

It does not own AWS account configuration, Runtime provisioning, product
authentication, authority issuance, model credentials, MCP tools, persistence,
result application, or UI. Adopters provide their region, Runtime ARN, optional
qualifier, and normal AWS credential environment at composition.

The same `AgentCoreRegionSchema`, `AgentCoreRuntimeArnSchema`,
`AgentCoreQualifierSchema`, and `AgentCoreExecutionTargetSchema` are public for
deployment configuration loaders. Consumers should use these contracts
directly instead of copying the rules or renaming their inferred types.

Both conversation turns and heartbeat tasks use the same AgentCore client,
Runtime-session validation, signed custom headers, one-attempt policy, and SSE
validation. Their request and result schemas remain separate workflow profiles.

```ts
import {
  AgentCoreExecutionHost,
} from '@heddleagent/execution-host-client/agentcore'

const executionHost = new AgentCoreExecutionHost({
  region: process.env.AWS_REGION!,
  runtimeArn: process.env.AGENTCORE_RUNTIME_ARN!,
  qualifier: process.env.AGENTCORE_RUNTIME_QUALIFIER,
})
```

The Runtime deployment must allowlist the names exported as
`AGENTCORE_FORWARDED_HEADER_NAMES`. The direct-host local token is deliberately
excluded and never reaches AWS.
