# `@heddleagent/runtime` 6.4.0

This release expands the advanced Runtime surface for unattended agents,
bounded delegation, and durable hosted memory.

## What changed

- add explicit `Unattended` and `Unrestricted` permission modes while keeping
  host policy ordering and audit behavior inside Heddle;
- add an advanced read-only delegation service with bounded child count,
  concurrency, steps, tools, cancellation, and result summaries;
- derive a stable, opaque memory scope from verified adopter, tenant, subject,
  and agent or workspace identity; and
- add a versioned, provider-neutral memory checkpoint contract with an
  allowlisted file codec, integrity validation, immutable generations,
  compare-and-swap manifests, non-overwriting restore-before-use, and explicit
  deletion.

The release also preserves serialized heartbeat stream values across hosted
execution and surfaces model quota failures without misclassifying them as
generic retryable errors.

## Boundaries

The memory checkpoint API is available from
`@heddleagent/runtime/advanced`. It does not include an S3 client, scheduling,
Execution Host lifecycle integration, general workspace backup, or portability
for configuration, approvals, MCP state, telemetry, artifacts, and active
execution. Technology-specific adapters implement the Runtime-owned store port
without changing its memory semantics.
