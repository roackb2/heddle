# `@heddleagent/runtime`

Status: **private package foundation; not published or installable**

This package will be the supported TypeScript/Node runtime and embeddable SDK
for products that run Heddle in their own process or inside a compatible
Execution Host.

## Owns

- the model/tool execution runtime and curated programmatic SDK;
- conversation engines, capabilities, approvals, traces, artifacts, and
  Heddle-owned persistence ports;
- the in-process addressable run service at the future `/runs` subpath; and
- optional Node HTTP/SSE run transport helpers at `/runs/http-sse`.

## Does not own

- the finished Heddle CLI, daemon, or browser control-plane product;
- browser-side protocol consumption;
- a product backend's separate Execution Host authority or network client;
- PostgreSQL implementations; or
- product authentication, records, policy, queries, retention, and UI.

The runtime will not depend on any other `@heddleagent/*` package. The CLI may
depend on it, and optional adapter packages may implement its public ports.

The planned public entrypoints are `.`, `/runs`, `/runs/http-sse`, `/advanced`,
and `/heartbeat/testing`. This is a package-surface plan, not a claim that those
entrypoints exist here today.

The current implementation remains in `@roackb2/heddle`. Activate this package
only through the coordinated migration that moves each implementation once,
adds package-local build and boundary tests, and freshly verifies the tarball.
See the [package-family boundary](../README.md) before changing this status.
