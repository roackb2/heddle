# Execution Host contracts

This module is the TypeScript reference implementation of the language-neutral
Execution Host v1 wire contract. It owns runtime validation for request bodies,
ordered SSE events, execution identity claims, MCP capability claims, and the
fixed header and token-type names shared by adopter backends and Execution Host
deployments.

The v1 binding has two explicit workflow profiles: `conversation-turn` and
`heartbeat-task`. They share identity, credential headers, strict stream
ordering, cancellation, and clean-EOF terminal truth, but keep distinct request,
activity, and result schemas. A heartbeat request is not disguised as a prompt.

It does not define product authentication, tenant lookup, authorization policy,
MCP tool behavior, persistence, AWS transport, or the Heddle runtime loop. An
adopter must derive scope from its authenticated product state before using
these schemas.

The Zod schemas generate the checked-in
[`spec/v1`](../../spec/v1/README.md) OpenAPI, JSON Schema, and golden fixtures.
Non-TypeScript implementations should verify those artifacts rather than
reimplementing behavior from prose alone. The clean-room
[Python v1 conformance reference](../../conformance/reference-adopters/python-v1/README.md)
demonstrates that
path without importing this TypeScript package.
