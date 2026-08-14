# Execution Host adopter contract v1

This directory is the language-neutral contract for an adopter backend which
invokes a Heddle-compatible Execution Host. It is published inside
`@roackb2/heddle-adopter`, but consuming it does not require JavaScript or
TypeScript.

## Artifacts

- `openapi.json` describes the current HTTP/SSE invocation binding.
- `schema-bundle.json` contains standalone JSON Schema Draft 2020-12
  definitions for requests, events, JWT claims, protected JWT headers, results,
  safe API errors, and the optional durable conversation-lifecycle profile.
- `fixtures/` contains executable examples for valid and invalid requests,
  complete and interrupted streams, cancellation, sequence validation, and
  execution/MCP authority. `durable-conversation-lifecycle.json` supplies the
  shared TypeScript/Python terminal and store-transition vectors.
- `durable-hosted-conversation-lifecycle.md` defines persistence ordering,
  transition fencing, safe projection, interruption, and reconciliation for a
  product-owned lifecycle store.

Generate checked-in artifacts from Heddle's runtime schemas:

```bash
yarn adopter:contract:generate
```

CI and package builds use the non-writing drift check:

```bash
yarn adopter:contract:verify
```

The checked-in JSON files are the released interoperability artifacts. The
TypeScript Zod schemas remain the reference implementation used to generate
them. A non-TypeScript adopter should implement the JSON/SSE/JWT contract and
run the golden fixtures; it should not port Heddle's agent loop.

## Semantic invariants

JSON Schema validates one value at a time. A conforming implementation must
also enforce these relationships:

1. Credentials are headers, never request-body fields, prompt content, event
   content, logs, or persisted product state.
2. The first event is `accepted` with sequence `0`.
3. Every later event has the same `invocationId` and `runId`, and sequence
   numbers increase by exactly one.
4. Exactly one `result`, `cancelled`, or `error` event is terminal and last.
5. A terminal event is committed only after clean HTTP EOF. EOF without a
   terminal is ambiguous interruption, never inferred success and never an
   automatic retry.
6. The execution assertion uses ES256 and
   `typ=heddle-execution+jwt`; its `jti` equals `invocationId`.
7. The optional MCP capability uses ES256 and
   `typ=heddle-mcp-capability+jwt`; its `jti` is distinct from
   `invocationId`.
8. The host binds every duplicated adopter, tenant, subject, product session,
   runtime session, invocation, and workflow claim across the request and both
   credentials.
9. The adopter MCP edge verifies the capability independently, derives scope
   only from verified claims, rejects unsupported tools, and rechecks expiry
   before each operation.
10. `allowedTools` is unique, contains at most 16 collision-free names, and the
    aggregate tool-name length is at most 512 characters.

The optional durable profile adds control-plane semantics around this stream.
It does not add a database endpoint to the Execution Host or make product
records part of the execution plane. See
[Durable hosted-conversation lifecycle](durable-hosted-conversation-lifecycle.md).

## Deployment bindings

The OpenAPI document names the actual v1 headers so implementations can
interoperate with the current Execution Host. Two headers are explicitly
binding-specific:

- `X-Amzn-Bedrock-AgentCore-Runtime-Session-Id` carries the logical
  `runtimeSessionId` in the AgentCore deployment. Another runtime adapter must
  preserve the same logical value even if its provider uses a different wire
  mechanism.
- `X-Heddle-Execution-Host-Local-Token` is only for the direct loopback
  development binding. Managed AgentCore ingress uses AWS authorization and
  explicitly forwarded custom headers instead.

The OpenAPI contract does not describe Terraform, image layout, SigV4 calls,
AWS account identity, or provider lifecycle. Those remain deployment concerns,
not adopter-domain contracts.

## Compatibility and stop line

Version 1 supports `conversation-turn`. New workflows, transports, or identity
forms require an explicit contract version decision; they are not silently
added to this surface.

The repository deliberately stops after this schema, fixture set, the
TypeScript implementation, and one Python clean-room reference pass. It does
not promise a gateway, generated clients for every language, or a framework
starter matrix. Additional adapters should be driven by a real adopter and a
specific interoperability gap.
