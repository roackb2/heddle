# Execution Host Client v6.0.0-next.0

This is the first prerelease candidate of
`@heddleagent/execution-host-client`. It moves the existing backend integration
kit to the clearer Heddle organization and package name without duplicating its
implementation.

The candidate includes the v1 wire contracts, ES256 authority, hosted
conversation orchestration and durable lifecycle, MCP verification, Node and
HTTP/SSE helpers, store conformance, canonical OpenAPI/JSON Schema fixtures,
and the independent Python conformance proof.

Install the preview explicitly after it is published:

```bash
npm install @heddleagent/execution-host-client@next
```

The compatible Execution Host itself remains private research. This package is
not a hosted service, a PostgreSQL adapter, or a supported Python SDK. The
stable `@roackb2/heddle-adopter@5.13.0` package remains available and is not
deprecated by this prerelease.

## Compatibility and verification

This is an explicit breaking import rename; no compatibility alias is shipped.
The root runtime, remote client, and PostgreSQL package remain at their current
versions. Before publication, the new coordinate must return npm `E404`, while
`@roackb2/heddle-adopter@5.13.0` must remain the unchanged `latest` release with
its published integrity preserved.

The release commit must pass package-family verification, typecheck, lint, the
full TypeScript and Python suites, build, artifact drift checks, and the packed
fresh-consumer runtime/type verification. Publication uses only the `next`
dist-tag; `latest` must remain absent. Record the package-specific annotated
tag, release commit, and post-publication integrity as release evidence. Exact
tarball publication may not populate npm `gitHead`, so it is not part of this
release's traceability claim.
