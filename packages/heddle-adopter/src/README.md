# Heddle adopter SDK source

This package is a backend-side reference implementation for products which
invoke a separately deployed Heddle Execution Host. Its modules are kept
independent so an adopter can use only the machinery it needs:

- `contracts`: language-neutral v1 claim and wire semantics, expressed as
  executable TypeScript/Zod schemas;
- `authority`: short-lived ES256 execution assertion and optional MCP
  capability issuance plus public JWKS projection;
- `mcp`: independent product-edge capability verification against a fixed
  deployment and supported-tool set;
- `http-sse`: a strict direct-development client behind a transport-neutral
  `ExecutionHost` port;
- `testing`: a Node-only loopback v1 contract fixture for adopter integration
  tests. It is intentionally available only through its explicit subpath.

The package must never import the Heddle runtime, Execution Host internals, AWS
SDK, MCP server SDK, a database adapter, or product domain code. New reusable
machinery belongs here only when it is required by more than one adopter and
can preserve that dependency boundary.
