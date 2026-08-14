# Execution Host Client v6.0.0

This is the first stable release of
`@heddleagent/execution-host-client`. It provides the reusable product-backend
contracts and lifecycle services for invoking a separately deployed compatible
Heddle Execution Host.

Install it normally:

```bash
npm install @heddleagent/execution-host-client
```

## What changed

- publish the package as the supported stable coordinate;
- include the v1 contracts, ES256 authority, hosted conversation lifecycle,
  MCP verification, Node and HTTP/SSE helpers, store conformance, and shared
  TypeScript/Python contract fixtures;
- add a fail-closed release-state check that rejects changed package bytes
  under an already published version;
- publish an absent immutable version from a GitHub-hosted runner through npm
  trusted publishing and short-lived OIDC authority;
- verify the exact tarball integrity, channel movement, fresh JavaScript and
  TypeScript consumers, annotated package tag, and GitHub release; and
- make ordinary relevant merges and same-commit recovery runs idempotent.

The workflow stores no npm write token. npm trusted publishing automatically
records provenance for the public package. Publication remains restricted to
repository `roackb2/heddle`, workflow `publish-packages.yml`, environment
`npm-release`, and the protected `main` branch.

## Publication

Publishing this version moves npm's `latest` tag to `6.0.0`. The historical
`next` tag remains at `6.0.0-next.0`; it is not part of the normal installation
path. The legacy `@roackb2/heddle-adopter@5.13.0` package remains available and
unchanged during migration.

The release is selected by the version and this matching release note. Merging
the reviewed release PR to `main` is the publication action; no manual npm
publish command should follow it. If an infrastructure failure occurs, rerun
the same workflow commit so its immutable-version and integrity checks can
reconcile safely.
