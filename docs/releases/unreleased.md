# Unreleased

## `@heddleagent/execution-host-client@6.0.0-next.0`

- Moves the canonical Execution Host integration implementation from the
  legacy `@roackb2/heddle-adopter` source coordinate into the new package.
- Preserves the v1 TypeScript contracts, authority, conversation lifecycle,
  MCP, Node, HTTP/SSE, testing, OpenAPI, JSON Schema, golden fixtures, and
  independent Python conformance proof.
- Adds guarded `next`-channel packaging with a fresh runtime and TypeScript
  consumer check. This candidate does not publish a compatible Execution Host,
  managed service, PostgreSQL adapter, or supported Python SDK.
