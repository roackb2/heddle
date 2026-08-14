# Execution Host Client v6.0.0-next.0

This is the first prerelease candidate of
`@heddleagent/execution-host-client`. It moves the existing backend integration
kit to the clearer Heddle organization and package name without duplicating its
implementation.

The candidate includes the v1 wire contracts, ES256 authority, hosted
conversation orchestration and durable lifecycle, MCP verification, Node and
HTTP/SSE helpers, store conformance, canonical OpenAPI/JSON Schema fixtures,
and the independent Python conformance proof.

Install the preview explicitly:

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
versions. Before publication, the new coordinate returned npm `E404`, while
`@roackb2/heddle-adopter@5.13.0` remained the unchanged `latest` release with
its published integrity preserved.

The release commit passed package-family verification, typecheck, lint, the
full TypeScript and Python suites, build, artifact drift checks, and packed
fresh-consumer runtime/type verification. The exact local, versioned-registry,
and `@next` tarballs contain 152 files and share this integrity:

```text
sha512-NSV7g4QkwGUfBae9Ox0vpuv+pkuZd+hN9qiIrFO2Rx5kR7gXNMx0c8xjtCi97pOWO2+ue+/KOmFzORxr1Cv/mg==
```

The package was published from signed annotated tag
`execution-host-client-v6.0.0-next.0` at commit `5e9b6c32`. npm requires every
package to have a `latest` tag, so the first publication created both `next`
and the unavoidable initial `latest`, each pointing to `6.0.0-next.0`. The
first stable release will deliberately move `latest`; prerelease automation
publishes through `next` without moving an existing stable `latest`.

Exact tarball publication may not populate npm `gitHead`, so traceability uses
the signed package tag, release commit, and registry integrity instead.
