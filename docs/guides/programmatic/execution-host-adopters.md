# Build an Execution Host adopter backend

Use `@roackb2/heddle-adopter` when your product backend does not embed Heddle
and instead invokes a separately deployed Heddle Execution Host. The package is
small on purpose: it provides the security-sensitive contract machinery while
your product keeps its language stack and domain ownership.

```text
ADOPTER BACKEND
  product authentication and authorization
  tenant / subject / product-session mapping
  durable invocation identity and result application
          |
  @roackb2/heddle-adopter
  authority + v1 contracts + ExecutionHost client port
          |
  HEDDLE EXECUTION HOST
  isolated Heddle loop and workstation
          |
  adopter-owned MCP endpoint
  independent capability verification + product tools
          |
  adopter APIs and database
```

The Execution Host receives no adopter database credential. Product data and
actions cross only the capability-bound MCP surface selected by the adopter.

## Backend sequence

For each invocation, the adopter backend must:

1. authenticate the product request;
2. authorize the relevant tenant, subject, and product session;
3. allocate or resolve the Runtime session ID and a durable, unique invocation
   ID;
4. issue a short-lived execution assertion and, only when needed, an MCP
   capability with the exact product tools allowed for that invocation;
5. invoke an `ExecutionHost` implementation and consume one ordered stream to a
   truthful terminal event;
6. apply the terminal result to product state idempotently;
7. independently verify the same MCP bearer at every product-MCP request and
   resolve identity only from the verified capability scope.

Do not automatically retry an invocation when the stream ends without a
terminal event. The execution might have completed after the adopter lost the
response. Reconcile through durable product state or an explicitly designed
result lookup before deciding whether another invocation is safe.

## Package boundary

Install only the adopter package in the backend:

```bash
npm install @roackb2/heddle-adopter
```

Its subpaths separate responsibility:

- `/contracts` provides executable TypeScript/Zod v1 claim and wire contracts;
- `/authority` issues ES256 assertions/capabilities and projects public JWKS;
- `/mcp` independently verifies product-MCP capabilities against a fixed
  deployment and supported-tool set;
- `/http-sse` provides the provider-neutral `ExecutionHost` port and strict
  direct-development transport;
- `/testing` provides a Node-only loopback v1 fixture for local product/MCP
  integration tests without a model or AWS.

See the [package README](../../../packages/heddle-adopter/README.md) for
copyable code.

The package deliberately excludes:

- end-user authentication, authorization, or tenant lookup;
- signing-key storage, rotation, and JWKS route registration;
- MCP tool registration, product APIs, or database access;
- AWS AgentCore/SigV4 transport and deployment;
- Heddle's loop, tools, model runtime, workspace, or state serialization;
- durable invocation deduplication, result recovery, billing, and UI.

## Identity and capability rules

The adopter ID, issuer, audiences, MCP server ID, key ID, and token lifetimes
are deployment configuration. They must never come from model input or an
untrusted caller. The authenticated application service supplies tenant,
subject, product-session, Runtime-session, and invocation IDs only after its
normal product policy has resolved them.

The execution assertion is short-lived admission authority. An optional MCP
capability has a separate token type, audience, and JTI, repeats the immutable
scope and invocation binding, and carries only an exact set of supported tool
names. The MCP service verifies it independently and rechecks expiry before
each operation. Tool arguments carry domain input—not identity claims.

Compact JWTs belong only in request headers and short-lived in-memory objects.
The SDK's issued object serializes credential-free metadata, but IDs remain
potentially sensitive product data and should still follow logging
minimization.

## Transport choices

`DirectHttpExecutionHost` targets local development and reviewed direct HTTPS
deployments. It owns strict request/SSE validation but uses the Execution Host
local-token ingress. It is not an AgentCore client.

A managed AgentCore adapter should implement the same `ExecutionHost` port with
the AWS SDK and SigV4 while preserving the same v1 body, forwarded custom
headers, ordered stream semantics, and no-ambiguous-retry rule. Keeping that
adapter separate prevents AWS types from leaking into the product application
service.

## Local contract verification

`LocalExecutionHostContractFixture` exercises the real v1 request and SSE
parsers while delegating execution to an adopter callback. Use that callback to
call the product's real local MCP endpoint, then return a deterministic result,
cancellation, error, or intentionally interrupted stream. The fixture owns a
hidden local token and aborts active callbacks during client or fixture
shutdown.

This test proves request/header placement, product callback reachability,
ordered streaming, terminal handling, and ambiguous-EOF behavior. It does not
prove Heddle execution, JWT verification inside the real host, shell or
filesystem behavior, tenant isolation, or AgentCore. Keep at least one real
Execution Host integration test for those properties.

## Language-neutral contract

TypeScript is the first reference implementation, not a requirement for
adopters. Python, Go, Java, or other backends can implement the same compact
claim and wire semantics without porting Heddle. Canonical JSON Schema/OpenAPI,
golden event/token fixtures, and clean-room Python/Go consumers are planned
conformance work; until then, treat this package and the Execution Host's v1
tests as the executable reference.

## Current limits

- v1 supports `conversation-turn`; autonomous/heartbeat workflow contracts are
  not generalized yet;
- MCP capability refresh and durable early revocation are not implemented;
- managed AgentCore transport and isolation evidence live outside this package;
- the direct stream has no reconnect/result-lookup protocol;
- adopters remain responsible for durable invocation uniqueness, key rotation,
  data retention, and result idempotency.
