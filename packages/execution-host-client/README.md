# `@heddleagent/execution-host-client`

Status: **private package foundation; not published or installable**

This package will serve product backends that invoke a separately deployed,
compatible Heddle Execution Host. TypeScript/Node adopters receive maintained
helpers; other languages implement the same versioned OpenAPI, JSON Schema,
and golden fixtures.

## Owns

- invocation and event contracts;
- execution authority, verification material, and bounded credentials;
- backend-side transport clients and Node integration helpers;
- generic durable invocation/turn lifecycle semantics over adopter-supplied
  atomic stores; and
- conformance fixtures and testing support.

## Does not own

- the Heddle agent loop or runtime;
- the separately deployed compatible Execution Host implementation;
- a Heddle-operated cloud service;
- product authentication, tenant mapping, database infrastructure, records,
  queries, retention, or UI; or
- a supported Python SDK. Python remains a clean-room conformance proof.

This package stays independent of `@heddleagent/runtime`; only the compatible
Execution Host imports the runtime. Official storage adapters may implement
its public lifecycle ports without moving product policy into Heddle.

Planned entrypoints preserve the current capability boundaries for contracts,
authority, conversation lifecycle, MCP, HTTP/SSE, Node helpers, testing, and
versioned specification artifacts. The current implementation remains in
`@roackb2/heddle-adopter`; migration must retain the language-neutral artifacts
and independent conformance proof. See the
[package-family boundary](../README.md) before changing this status.
