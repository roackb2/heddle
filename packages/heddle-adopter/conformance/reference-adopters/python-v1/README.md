# Python adopter contract v1 conformance reference

This is a small, clean-room Python implementation of the published Execution
Host adopter contract. It proves that a non-TypeScript backend can integrate
without importing Heddle or the private Execution Host implementation.

It is deliberately a version-pinned conformance reference, not a separately
published or supported Python SDK. The editable package installation exists
only so CI can execute conformance. Heddle does not publish it to PyPI, promise
Python API stability, or provide Python SDK support. It does not mirror new
TypeScript helpers. Its boundaries implement only stable v1 protocol concepts:

- `authority.py` issues an ES256 execution assertion and optional MCP
  capability, then publishes public JWKS.
- `mcp.py` independently verifies that capability at the adopter's MCP edge and
  adapts it to the official MCP Python SDK's `TokenVerifier` protocol.
- `http_sse.py` invokes `/invocations` and strictly consumes the ordered v1 SSE
  stream without inferring success from ambiguous EOF.
- `contracts.py` validates checked-in JSON Schema and the semantic identifier,
  tool, and URL constraints which JSON Schema alone cannot express.
- `lifecycle.py` implements the optional normative durable-conversation
  profile over an adopter-owned store. It exists because the profile and
  golden vectors are language-neutral, not to promise general SDK parity.

Product authentication, authorization, tenant selection, database schema and
migrations, retention, history queries, tool behavior, model credential
policy, and deployment stay in the adopter. Heddle's loop stays in the
Execution Host.

## Verify

From this directory:

```bash
python -m venv .venv
. .venv/bin/activate
python -m pip install -e '.[test]'
python -m ruff check .
python -m pytest
```

The tests consume `../../../spec/v1` directly. They execute the same golden
request, SSE, authority, lifecycle projection/store, expiry, unsupported-tool,
and swapped-scope cases as the TypeScript implementation.

## MCP server integration

`McpSdkCapabilityTokenVerifier` implements the official `mcp` v2
`TokenVerifier` protocol. Supply it to an `MCPServer` together with the MCP
SDK's `AuthSettings`, configure Streamable HTTP as stateless, and derive tool
scope from the verified `AccessToken.claims`. The adapter intentionally places
a redacted identifier—not the bearer credential—in `AccessToken.token`.

Do not accept tenant, subject, product-session, runtime-session, invocation, or
allowed-tool values from model tool arguments. Those values come only from the
verified capability claims.

This reference stops at the contract boundary. It does not add PostgreSQL or
SQLite adapters, a Python store-testing package, an adopter gateway, web
framework starter, AgentCore client, or deployment automation. It changes only
when the normative v1 wire/lifecycle contract, security invariants, or golden
fixtures change. Node conveniences and provider-specific adapters do not
create Python parity work.
