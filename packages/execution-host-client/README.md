# `@heddleagent/execution-host-client`

`@heddleagent/execution-host-client` is the backend-side SDK for
products that invoke a separately deployed Heddle Execution Host. It lets an
adopter keep its own language stack, authentication, database, product policy,
MCP tools, and UI while reusing the security-sensitive v1 contract machinery.

> **Current availability:** `6.5.0` is the next manual release from this
> repository; `6.4.0` remains the latest published version until then. The former
> `@roackb2/heddle-adopter@5.13.0` coordinate is deprecated and remains
> installable only for existing consumers. Heddle does not currently distribute
> the compatible Execution Host implementation or offer a hosted service. The
> public surface documents and tests the adopter boundary without implying a
> generally available deployment.

Install the package:

```bash
npm install @heddleagent/execution-host-client
```

The package does **not** contain Heddle's agent loop, AgentCore Runtime
deployment, Terraform, product MCP tools, or product logic. It uses the
modular AWS SDK for its AgentCore transport and the official MCP SDK, plus
`jose`, `zod`, `dayjs`, and `eventsource-parser`, for its other edges.

## What it owns

| Import | Reusable responsibility |
| --- | --- |
| `@heddleagent/execution-host-client/contracts` | Runtime-validated v1 request, stream, identity, capability, and header contracts |
| `@heddleagent/execution-host-client/authority` | ES256 execution assertion and optional MCP capability issuance plus public JWKS projection |
| `@heddleagent/execution-host-client/conversation` | Turn orchestration across authority, model credentials, optional MCP policy, an `ExecutionHost`, and an optional adopter-implemented durable lifecycle store |
| `@heddleagent/execution-host-client/heartbeat` | Remote heartbeat orchestration that keeps durable task authority in a coordinator while a compatible Execution Host runs the agent cycle |
| `@heddleagent/execution-host-client/coordinator` | Authenticated task publication, pause-first desired-state reconciliation, product delegation, and delegated heartbeat execution |
| `@heddleagent/execution-host-client/coordinator/node` | Standard authenticated Node HTTP edge for product-owned heartbeat authorization |
| `@heddleagent/execution-host-client/mcp` | Independent capability verification at the adopter's MCP edge |
| `@heddleagent/execution-host-client/mcp/node` | Stateless official-SDK Streamable HTTP lifecycle around adopter-defined toolsets |
| `@heddleagent/execution-host-client/http-sse` | Transport-neutral conversation and heartbeat ports plus the strict direct-development HTTP/SSE client |
| `@heddleagent/execution-host-client/agentcore` | Official AWS AgentCore/SigV4 implementation of the same conversation and heartbeat ports |
| `@heddleagent/execution-host-client/host` | Invocation-bound execution-identity and MCP-capability verification shared by compatible Execution Host implementations |
| `@heddleagent/execution-host-client/testing` | Node-only loopback v1 fixture plus durable-turn store conformance for real adapters |
| `@heddleagent/execution-host-client/node` | Optional Node JWKS/conversation HTTP edge plus safe local signing-key helpers |

Non-TypeScript adopters can consume the versioned
[`spec/v1`](spec/v1/README.md) OpenAPI 3.1.1 document, JSON Schema bundle, and
golden conformance fixtures directly. The
[`Python v1 conformance reference`](conformance/reference-adopters/python-v1/README.md)
is an independent executable proof of that path, not another required service
or a separately supported SDK. It follows the contract version, not the
TypeScript source-module layout.

The adopter still owns:

- authenticating its users and mapping them to tenant, subject, and product
  session IDs;
- deciding which product capabilities that identity may use;
- production signing-key storage and rotation, route placement, invocation-ID
  allocation, the lifecycle-store implementation/schema/migrations, retention,
  and history queries;
- implementing and hosting product MCP tools against its own APIs and data;
- choosing and provisioning its AgentCore Runtime, applying results, and
  rendering UI.

## Issue one invocation's authority

Load an ES256 key pair from your normal secret-management boundary, then create
one long-lived authority service at application composition:

```ts
import { JoseExecutionAuthority } from '@heddleagent/execution-host-client/authority'

const authority = await JoseExecutionAuthority.create(
  {
    issuer: 'https://api.example.com',
    adopterId: 'example-product',
    executionAudience: 'heddle-execution-host',
    keyId: 'execution-key-2026-08',
    executionTtlSeconds: 300,
    mcp: {
      audience: 'example-product-mcp',
      serverId: 'product_capabilities',
      ttlSeconds: 900,
    },
  },
  { privateKey, publicKey },
)

// Serve only this public projection from a stable JWKS URL.
const publicJwks = authority.publicJwks()

// These IDs must come from authenticated and authorized product state.
const issued = await authority.issue({
  scope: {
    tenantId: authenticatedTenant.id,
    subjectId: authenticatedUser.id,
    productSessionId: conversation.id,
  },
  runtimeSessionId,
  invocationId,
  workflow: 'conversation-turn',
  mcp: { allowedTools: ['read_workspace_snapshot'] },
})
```

An invocation without product MCP tools omits both the `mcp` deployment config
and issue input. The execution assertion remains available through
`issued.executionAssertion()`; an optional capability is available through
`issued.mcpCapability()`. JSON serialization emits only credential-free
metadata, although those identifiers still require normal logging
minimization.

## Use the lowest-code Node path

The optional Node surface removes generic HTTP and local key-file code without
taking product decisions away from the adopter:

```ts
import { JoseExecutionAuthority } from '@heddleagent/execution-host-client/authority'
import {
  DurableHostedConversationTurnService,
  HostedConversationTurnService,
} from '@heddleagent/execution-host-client/conversation'
import {
  loadExecutionAuthorityKeyPairFromFile,
  NodeExecutionAdopterHttpService,
} from '@heddleagent/execution-host-client/node'

const authority = await JoseExecutionAuthority.create(
  authorityConfig,
  await loadExecutionAuthorityKeyPairFromFile(signingJwkPath),
)
const executionTurns = new HostedConversationTurnService({
  authority,
  executionHost,
  modelCredentials,
  mcp: { allowedTools: ['read_workspace_snapshot'] },
})
const turns = new DurableHostedConversationTurnService({
  turns: executionTurns,
  store: productPostgresTurnStore,
})
const hostedHttp = new NodeExecutionAdopterHttpService({
  authority,
  authenticator: productAuthenticator,
  conversations: productAdmissionService(turns),
})

// In a raw Node server, call this before the application's fallback router.
if (hostedHttp.handle(request, response)) return
```

`productAdmissionService` is intentionally product-owned: it maps an
authenticated principal to authorized tenant, subject, product-session,
Runtime-session, and invocation IDs before calling `turns.streamTurn(...)`.
The durable wrapper owns persistence-before-event ordering, safe terminal
projection, interruption semantics, and expiry reconciliation. The supplied
store owns atomic database transitions and is certifiable through
`HostedConversationTurnStoreConformance`.
The normative behavior and cross-language scenarios are included in the
[durable v1 lifecycle profile](spec/v1/durable-hosted-conversation-lifecycle.md).
The Node service owns bounded JSON parsing, `Authorization` redaction, JWKS,
SSE framing/backpressure, disconnect cancellation, safe failures, and graceful
shutdown. Its individual `handleJwks` and `handleConversationTurn` methods are
also available when a framework already owns route matching.

For local setup, `generateExecutionAuthorityKeyFile(path)` creates a new
owner-only JWK without overwriting an existing file. The loader imports its
private key as non-exportable. Production KMS/HSM or secret-manager storage,
rotation, revocation, and Windows ACL policy still belong to deployment.

## Verify product authority again at MCP

The adopter MCP service must independently verify the bearer. Do not trust
identity forwarded in model-controlled arguments or assume the Execution Host's
earlier check is sufficient.

```ts
import {
  JwtMcpCapabilityVerifier,
  assertMcpCapabilityActive,
} from '@heddleagent/execution-host-client/mcp'

const verifier = new JwtMcpCapabilityVerifier({
  issuer: 'https://api.example.com',
  audience: 'example-product-mcp',
  jwksUrl: new URL('https://api.example.com/.well-known/jwks.json'),
  trustedAdopterId: 'example-product',
  serverId: 'product_capabilities',
  supportedTools: ['read_workspace_snapshot'] as const,
  maxCapabilityAgeSeconds: 900,
})

const capability = await verifier.verify(bearer)
assertMcpCapabilityActive(capability)

// Resolve data only from capability.scope; tool arguments do not carry scope.
await readWorkspaceSnapshot(capability.scope)
```

For Node adopters, the declarative JSON-tool path also removes the repetitive
allowlist, expiry, cancellation, serialization, and safe-error code:

```ts
import {
  defineNodeMcpJsonTool,
  NodeMcpJsonToolset,
  NodeStreamableHttpMcpService,
} from '@heddleagent/execution-host-client/mcp/node'
import { z } from 'zod'

const toolset = new NodeMcpJsonToolset({
  serverInfo: { name: 'example-product', version: '1.0.0' },
  tools: [defineNodeMcpJsonTool({
    name: 'read_workspace_snapshot' as const,
    description: 'Read the authenticated subject workspace.',
    inputSchema: z.object({}).strict(),
    annotations: { readOnlyHint: true },
    failureMessage: 'The workspace is unavailable.',
    execute: async (_input, { capability, signal }) => (
      readWorkspaceSnapshot(capability.scope, signal)
    ),
  })],
})

const productMcp = new NodeStreamableHttpMcpService({
  capabilityVerifier: verifier,
  toolset,
})
```

Use the lower-level `NodeMcpToolset` interface only when a tool needs custom MCP
content or lifecycle semantics.

## Verify authority inside a compatible Execution Host

The host must independently verify the adopter's execution assertion before it
trusts product scope, then bind any optional MCP capability to that same
verified invocation. Compatible host implementations can reuse that generic
security boundary instead of maintaining their own JOSE logic:

```ts
import {
  JwtExecutionHostMcpCapabilityVerifier,
  JwtExecutionIdentityVerifier,
} from '@heddleagent/execution-host-client/host'

const identity = await new JwtExecutionIdentityVerifier({
  executionIssuer: 'https://api.example.com',
  executionAudience: 'heddle-execution-host',
  executionJwksUrl: new URL('https://api.example.com/.well-known/jwks.json'),
  executionJwtAlgorithms: ['ES256'],
  trustedAdopterId: 'example-product',
  maxAssertionAgeSeconds: 300,
  assertionClockToleranceSeconds: 5,
}).verify({
  assertion: executionAssertion,
  runtimeSessionId,
  invocationId,
  workflow: 'conversation-turn',
})

const capability = await new JwtExecutionHostMcpCapabilityVerifier({
  issuer: 'https://api.example.com',
  audience: 'example-product-mcp',
  jwksUrl: new URL('https://api.example.com/.well-known/jwks.json'),
  jwtAlgorithms: ['ES256'],
  trustedAdopterId: 'example-product',
  serverId: 'product_capabilities',
  maxCapabilityAgeSeconds: 900,
  clockToleranceSeconds: 5,
}).verify({ assertion: mcpCapability, identity })
```

This surface owns credential verification and exact scope binding. It does not
own HTTP ingress, Runtime-session isolation, model credentials, streaming,
provider bootstrap, or deployment.

## Invoke an Execution Host

Use the official AgentCore client for a Runtime deployed in the adopter's AWS
account. It uses the normal AWS credential chain, signs the required Heddle
authority headers, streams the response through the same strict protocol
validation as the direct client, and deliberately makes only one ambiguous
streaming attempt.

```ts
import {
  AgentCoreExecutionHost,
} from '@heddleagent/execution-host-client/agentcore'

const host = new AgentCoreExecutionHost({
  region: process.env.AWS_REGION!,
  runtimeArn: process.env.AGENTCORE_RUNTIME_ARN!,
  qualifier: process.env.AGENTCORE_RUNTIME_QUALIFIER,
})
```

The product still owns the AWS account, Runtime deployment, IAM policy,
configuration, and credentials environment. Heddle owns only the reusable
invocation transport.

For local development and reviewed direct HTTPS deployments, use the direct
client:

```ts
import { DirectHttpExecutionHost } from '@heddleagent/execution-host-client/http-sse'

const host = new DirectHttpExecutionHost({
  baseUrl: new URL('http://127.0.0.1:8080'),
  localToken: process.env.HEDDLE_EXECUTION_HOST_LOCAL_TOKEN!,
})

for await (const event of host.streamConversationTurn({
  invocationId,
  runtimeSessionId,
  prompt: 'Summarize the relevant product state.',
  executionAssertion: issued.executionAssertion(),
  mcpCapability: issued.mcpCapability(),
  modelApiKey,
})) {
  applyExecutionEvent(event)
}
```

The client refuses redirects, bounds parser and error bodies, validates ordered
SSE identity, streams accepted/activity events incrementally, and withholds the
terminal event until clean EOF. It never retries an ambiguous invocation.

## Connect a product to the heartbeat coordinator

The product publishes only its desired task state and authorizes individual
runs. Heddle owns the coordinator protocol, safe reconciliation order, Runtime
session derivation, short-lived authority bundle, and execution composition.

```ts
import {
  HostedHeartbeatCoordinatorClient,
  HostedHeartbeatDelegationService,
  HostedHeartbeatTaskReconciler,
} from '@heddleagent/execution-host-client/coordinator'
import {
  NodeHostedHeartbeatDelegationHttpService,
} from '@heddleagent/execution-host-client/coordinator/node'

const coordinator = new HostedHeartbeatCoordinatorClient({
  baseUrl: coordinatorUrl,
  apiToken: coordinatorApiToken,
})
await new HostedHeartbeatTaskReconciler({ coordinator }).reconcile({
  desiredTasks: await projectDesiredHeartbeatTasks(),
  resume: backgroundChecksEnabled,
})

const delegations = new HostedHeartbeatDelegationService({
  authority,
  runtimeSessionNamespace: 'example-product',
  maxExecutionMs: 300_000,
  authorizer: {
    authorize: ({ taskId, signal }) =>
      authorizeProductHeartbeat({ taskId, signal }),
  },
})
const delegationHttp = new NodeHostedHeartbeatDelegationHttpService({
  delegations,
  apiToken: coordinatorDelegationToken,
})
```

`projectDesiredHeartbeatTasks` remains product-owned because it translates
product records into desired Heddle tasks. `authorizeProductHeartbeat` remains
product-owned because it decides whether the task may run and returns only the
authorized tenant/subject/product-session scope and exact MCP tool set. Product
code does not construct coordinator requests, Runtime-session IDs, deadlines,
JWTs, or delegation response objects.

The Node handler can be mounted before an existing router through
`delegationHttp.handle(request, response)`. See the
[coordinator boundary](src/coordinator/README.md) for the corresponding
coordinator-side client and execution transport.

## Compose the coordinator execution transport

For autonomous work, keep the durable task store and scheduler in one
long-running coordinator. Inject the hosted transport only at the point where
the scheduler would otherwise run the local heartbeat agent. The coordinator
uses the product delegation endpoint rather than receiving product signing
keys or reimplementing its authority shape:

```ts
import { HeartbeatSchedulerService } from '@heddleagent/runtime/advanced'
import {
  HostedHeartbeatDelegatedExecutionTransport,
  HostedHeartbeatDelegationClient,
} from '@heddleagent/execution-host-client/coordinator'

const delegations = new HostedHeartbeatDelegationClient({
  baseUrl: productBackendUrl,
  apiToken: productDelegationToken,
})
const agentExecutionTransport = new HostedHeartbeatDelegatedExecutionTransport({
  delegations,
  executionHost: agentCoreExecutionHost,
  modelCredentials,
})

const scheduler = HeartbeatSchedulerService.start({
  store: heddleHeartbeatStore,
  agentExecutionTransport,
})
```

The coordinator still owns task lookup, claims, checkpoint loading,
cancellation, claim-fenced settlement, history, and recovery. The Runtime
receives a bounded task/checkpoint request plus invocation-scoped authority and
model credentials; it receives no Heddle database credential. Omitting
`agentExecutionTransport` preserves the existing in-process runner. The lower
level `/heartbeat` composition remains available for deployments whose
coordinator and product authority live in the same process.

## Verify an adopter integration locally

The explicit `testing` subpath provides a real loopback implementation of the
v1 request/SSE boundary. Its callback can call the adopter's real local MCP
server, while the fixture supplies deterministic success, cancellation,
failure, and interrupted-EOF behavior without invoking a model or AWS.

```ts
import {
  LocalExecutionHostContractFixture,
} from '@heddleagent/execution-host-client/testing'

const fixture = await LocalExecutionHostContractFixture.start({
  execute: async (invocation) => {
    await callProductMcp(invocation.mcpCapability(), invocation.signal)
    return { kind: 'result', result: { outcome: 'done' } }
  },
})

try {
  const host = fixture.createExecutionHost()
  await consume(host.streamConversationTurn(input))
} finally {
  await fixture.close()
}
```

This proves the adopter-facing wire and product callback, not the Heddle loop,
real-host JWT verification, shell/filesystem behavior, tenant isolation, or
managed AgentCore behavior. See the [testing boundary](src/testing/README.md)
for the exact evidence limit.

## Language-neutral posture

This TypeScript package is a reference implementation, not a requirement that
adopter backends use TypeScript. The wire and claim contracts are
language-neutral. The checked-in OpenAPI 3.1.1 document, JSON Schema bundle,
and golden fixtures are the canonical interoperability surface. A clean-room
Python implementation passes those fixtures without importing Heddle or the
private Execution Host code.

That is the deliberate stop line for this milestone. Heddle does not promise a
gateway, generated clients for every language, or a framework starter matrix.
Further adapters should follow a real adopter and a concrete protocol gap.

The runnable
[`node-control-plane.ts`](examples/node-control-plane.ts) example composes the
default Node path against the local fixture.
