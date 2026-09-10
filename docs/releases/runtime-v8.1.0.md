# `@heddleagent/runtime` 8.1.0

This additive release lets curated MCP host tools retain Heddle's existing
successful terminal-result behavior.

## What changed

- Add `McpHostToolOverride.returnDirect` to the public MCP host-extension API.
- Project the host-owned override into the generated `ToolDefinition`, including
  request-scoped MCP extensions with short-lived authorization headers.
- Keep existing behavior unchanged by default: tools without the override
  continue through the normal model loop, and failed overridden calls remain
  recoverable within the current run.

## Usage

Set `returnDirect: true` only for a curated MCP operation whose successful
result is already the canonical run result. Heddle records the tool result and
finishes the run without requesting another model turn.

Terminal behavior remains host-owned and must not be inferred from untrusted
remote MCP metadata or content. The host and remote service remain responsible
for authorization, idempotency, domain persistence, and the returned result.

## Verification

The release candidate is verified with focused request-scoped MCP tests for
successful terminal completion, unchanged non-overridden behavior, and failed
call recovery, plus the repository build/test baseline and Runtime package
build.
