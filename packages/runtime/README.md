# `@heddleagent/runtime`

The supported TypeScript and Node.js runtime for embedding Heddle in a product
backend, worker, desktop process, or compatible Execution Host.

```bash
npm install @heddleagent/runtime
```

The default entrypoint is the curated SDK:

```ts
import {
  ConversationAgentService,
  createConversationEngine,
} from '@heddleagent/runtime'
```

Use the subpaths only when the host needs their additional assumptions:

```ts
import { ConversationRunService } from '@heddleagent/runtime/runs'
import { streamConversationRunSse } from '@heddleagent/runtime/runs/http-sse'
import { HeartbeatRunService, OpenAiAdapter } from '@heddleagent/runtime/advanced'
import { HeartbeatTaskStoreConformance } from '@heddleagent/runtime/heartbeat/testing'
```

## Entry points

| Import | Responsibility |
| --- | --- |
| `@heddleagent/runtime` | Curated conversation SDK, tools, MCP extensions, approvals, results, and persistence ports |
| `@heddleagent/runtime/runs` | Process-local addressable runs, replay, cancellation, and approval resolution |
| `@heddleagent/runtime/runs/http-sse` | Optional Node HTTP/SSE cursor, framing, backpressure, and disconnect helpers |
| `@heddleagent/runtime/advanced` | Lower-level models, tools, memory, trace, heartbeat, browser drivers, and embeddable server composition |
| `@heddleagent/runtime/cli` | Curated package-to-package bridge used by the official CLI product |
| `@heddleagent/runtime/heartbeat/testing` | Executable conformance scenarios for custom heartbeat task stores |

The `/runs` entrypoint was named `/hosted` on the former
`@roackb2/heddle` package. The implementation and behavior are unchanged; the
new name makes clear that it is an in-process run service, not a hosted Heddle
service.

## Owns

- the model/tool execution loop and curated programmatic SDK;
- conversation engines, capabilities, approvals, traces, artifacts, and
  Heddle-owned persistence ports;
- process-local run lifecycle mechanics; and
- reusable heartbeat and low-level runtime composition.

`HeartbeatRunService` starts one explicitly requested heartbeat cycle and
returns its run id, result promise, ordered activity stream, and cancellation
operation. A compatible Execution Host should use that handle rather than
reimplementing callback buffering or terminal sequencing. Scheduling, task
persistence, and deployment-specific model/tool/MCP preparation stay outside
the service.

Low-level agent and heartbeat runs use Heddle's built-in prompt composition by
default. A host with a complete product-owned charter may pass
`promptComposition: { mode: 'host-owned', systemPrompt }`. Heddle then sends
that non-blank system prompt exactly and keeps the goal or durable heartbeat
task as a separate, unchanged user message. This option changes no tool,
approval, lifecycle, checkpoint, trace, or heartbeat decision semantics.

A custom recurring heartbeat handler may call
`context.preferNextRunAt({ at: Date })` once after `runAgent()` succeeds, then
return that exact result. Claim-fenced settlement chooses the earlier of this
one-off preference and the normal recurring deadline. It cannot delay or
disable the configured cadence and is not an explicit run request; product
policy and persistence remain outside Runtime. Once applied, the preference is
the ordinary next deadline without separate provenance or cancellation, so a
later product-side clear can leave one already-scheduled extra run.

`RuntimeCredentialService.acquireRequestScopedCredentialForModel` lets a Node
host reuse its Heddle OpenAI account login safely across an isolation boundary.
Heddle refreshes and persists the stored credential at the host boundary, then
returns only an access token, expiry, and optional account identifier. The
refresh token must never be passed to an Execution Host.

## Does not own

- the finished `heddle` command, TUI, daemon lifecycle, or built browser UI;
- browser-side run protocol consumption;
- product-backend authority for a separate compatible Execution Host;
- PostgreSQL or other technology-specific persistence implementations; or
- product authentication, records, policy, queries, retention, and UI.

The optional `playwright` peer enables the built-in Playwright browser driver.
The optional `cyberloop` peer supports CyberLoop integrations. Neither is
required for ordinary conversation-agent use.

## Package boundary

This package compiles the repository's canonical runtime source graph. It does
not maintain a second copy of the runtime implementation. The
`@heddleagent/cli` product may depend on this package; the runtime must never
depend on the CLI. Technology-specific packages implement public runtime ports
one way and are never imported by the runtime itself.

The former `@roackb2/heddle@5.13.0` package is deprecated and remains
installable only for existing consumers. New SDK installations use this
package; new coding-agent installations use `@heddleagent/cli`.
