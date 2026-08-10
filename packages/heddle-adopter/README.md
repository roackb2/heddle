# `@roackb2/heddle-adopter`

`@roackb2/heddle-adopter` is the lightweight backend-side SDK for products
which invoke a separately deployed Heddle Execution Host. It lets an adopter
keep its own language stack, authentication, database, product policy, MCP
tools, and UI while reusing the security-sensitive v1 contract machinery.

```bash
npm install @roackb2/heddle-adopter
```

The package does **not** contain Heddle's agent loop, AgentCore deployment,
Terraform, MCP server, or product logic. It depends only on `jose`, `zod`, and
`eventsource-parser`.

## What it owns

| Import | Reusable responsibility |
| --- | --- |
| `@roackb2/heddle-adopter/contracts` | Runtime-validated v1 request, stream, identity, capability, and header contracts |
| `@roackb2/heddle-adopter/authority` | ES256 execution assertion and optional MCP capability issuance plus public JWKS projection |
| `@roackb2/heddle-adopter/mcp` | Independent capability verification at the adopter's MCP edge |
| `@roackb2/heddle-adopter/http-sse` | Transport-neutral `ExecutionHost` port and strict direct-development HTTP/SSE client |
| `@roackb2/heddle-adopter/testing` | Node-only loopback v1 fixture for local product/MCP integration tests |

The adopter still owns:

- authenticating its users and mapping them to tenant, subject, and product
  session IDs;
- deciding which product capabilities that identity may use;
- loading and rotating signing keys, publishing JWKS, and retaining durable
  invocation/replay records;
- implementing and hosting product MCP tools against its own APIs and data;
- choosing an AgentCore/SigV4 transport, applying results, and rendering UI.

## Issue one invocation's authority

Load an ES256 key pair from your normal secret-management boundary, then create
one long-lived authority service at application composition:

```ts
import { JoseExecutionAuthority } from '@roackb2/heddle-adopter/authority'

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

## Verify product authority again at MCP

The adopter MCP service must independently verify the bearer. Do not trust
identity forwarded in model-controlled arguments or assume the Execution Host's
earlier check is sufficient.

```ts
import {
  JwtMcpCapabilityVerifier,
  assertMcpCapabilityActive,
} from '@roackb2/heddle-adopter/mcp'

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

## Invoke the direct development host

The direct client is useful for local and reviewed HTTPS deployments. A
managed AgentCore deployment should supply a separate SigV4/AWS SDK transport
which implements the same `ExecutionHost` port.

```ts
import { DirectHttpExecutionHost } from '@roackb2/heddle-adopter/http-sse'

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

## Verify an adopter integration locally

The explicit `testing` subpath provides a real loopback implementation of the
v1 request/SSE boundary. Its callback can call the adopter's real local MCP
server, while the fixture supplies deterministic success, cancellation,
failure, and interrupted-EOF behavior without invoking a model or AWS.

```ts
import {
  LocalExecutionHostContractFixture,
} from '@roackb2/heddle-adopter/testing'

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
language-neutral. Future Python and Go packages can implement the same compact
surface without importing Heddle or the private Execution Host code. Canonical
JSON Schema/OpenAPI and golden conformance fixtures are the next step for
preventing language-specific drift.
