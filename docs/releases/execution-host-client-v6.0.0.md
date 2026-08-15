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
  TypeScript/Python contract fixtures; and
- verify the packed exports and fixtures with JavaScript and TypeScript
  consumers before manual publication.

## Publication

Publishing this version moves npm's `latest` tag to `6.0.0`. The historical
`next` tag remains at `6.0.0-next.0`; it is not part of the normal installation
path. The legacy `@roackb2/heddle-adopter@5.13.0` package remains available and
unchanged during migration.

The package was published from the reviewed release commit as a separate
manual operator action. Merging a future release to `main` does not publish it.
