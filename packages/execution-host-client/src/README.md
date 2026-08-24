# Heddle adopter SDK source

This package is a backend-side reference implementation for products which
invoke a separately deployed Heddle Execution Host. Its modules are kept
independent so an adopter can use only the machinery it needs:

- `contracts`: language-neutral v1 claim and wire semantics, expressed as
  executable TypeScript/Zod schemas and candidate OpenAPI/JSON Schema/golden
  artifacts;
- `authority`: short-lived ES256 execution assertion and optional MCP
  capability issuance plus public JWKS projection;
- `conversation`: provider-neutral authority, credential, tool-policy, and
  Execution Host turn orchestration;
- `heartbeat`: one remotely executed heartbeat cycle behind Heddle's existing
  scheduler transport;
- `coordinator`: authenticated task publication, desired-state reconciliation,
  product delegation, and delegated heartbeat execution shared by products and
  the Heddle coordinator;
- `coordinator/node`: the standard authenticated Node HTTP edge for a
  product-owned heartbeat authorization decision;
- `mcp`: independent product-edge capability verification against a fixed
  deployment and supported-tool set;
- `mcp/node`: optional official-SDK Streamable HTTP lifecycle around an
  adopter-owned product toolset;
- `http-sse`: a strict direct-development client behind a transport-neutral
  `ExecutionHost` port;
- `testing`: a Node-only loopback v1 contract fixture for adopter integration
  tests. It is intentionally available only through its explicit subpath.
- `node`: optional Node HTTP edge and safe local signing-key conveniences. It
  owns generic mechanics, never product identity or tool policy.

The package must never import the Heddle runtime, Execution Host internals, a
database adapter, or product domain code. The explicit `agentcore` surface may
import the modular AWS SDK, and `mcp/node` may import the official MCP SDK, but
neither owns product deployment or model-visible tools. New reusable machinery
belongs here only when it is required by more than one adopter and can preserve
that dependency boundary.

The repository includes one clean-room Python consumer to prove the versioned
contract is implementable outside TypeScript. It is a bounded conformance
reference, not a reason to add a parallel framework or language matrix.
