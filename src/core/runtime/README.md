# Runtime

The runtime domain owns host-facing execution entry points and generic runtime
coordination that sit around the lower-level agent loop.

## Owns

- Programmatic run entry points such as `AgentLoopRuntimeService.run(...)`.
- Host-facing `AgentLoopEvent` shapes and checkpoint state.
- Provider credential resolution for runtime execution.
- Default runtime tool bundle assembly.
- Workspace catalog ownership and daemon/runtime-host discovery.

## Does Not Own

- Model/tool step mechanics inside a run. Those live in `src/core/agent`.
- Persisted chat session semantics, compaction, and turn persistence. Those live
  in `src/core/chat`.
- Heartbeat task scheduling, checkpoint reuse, task/run persistence, and
  heartbeat host views. Those live in `src/core/heartbeat`.
- Individual tool behavior. That lives in `src/core/tools`.
- TUI, web, server route, or browser-specific presentation logic.

## Public Entry Points

- `loop/`: evented programmatic run service, loop event contracts, and
  checkpoint state helpers.
- `credentials/`: provider credential source resolution for runtime execution.
- `provider-runtime/`: provider, credential-source, and adapter-runtime
  resolution for selected models.
- `tools/`: default runtime tool bundle assembly.
- `workspaces/`: workspace catalog service, repository, types, and schemas.
- `daemon/`: daemon registry service, host resolver, message formatter, types,
  and schemas.

## Extension Points

- Add new host-facing runtime events in `loop/` only when they describe
  stable integration behavior.
- Add default tool groups through toolkit composition once the tool-domain
  refactor lands; until then keep `RuntimeToolService.createDefaultAgentTools`
  stable.

## Common Changes

- To add a new low-level run lifecycle event, update `AgentLoopEvent`, emit it in
  `loop/`, and add tests that assert the event ordering.
- To add heartbeat behavior, update `src/core/heartbeat` first, then keep
  CLI/control-plane adapters thin.
- To adjust model credential resolution, update `credentials/` and add provider
  credential tests.

## Tests

- `src/__tests__/integration/core/agent-loop.test.ts`
- `src/__tests__/integration/core/provider-credentials.test.ts`
- `src/__tests__/integration/server/runtime-hosts.test.ts`
- `src/__tests__/integration/server/daemon-registry.test.ts`

## Notes For Coding Agents

- Keep this domain UI-free. Do not import from `src/cli-v2`, `src/web-v2`, or
  `src/server`.
- `AgentLoopRuntimeService.run(...)` is the public single-run embedding API; do
  not couple it to chat sessions.
- Preserve `AgentLoopEvent` compatibility. External hosts and examples consume
  these events.
- New runtime subdomains should follow the class-backed service shape used by
  `workspaces/` and `daemon/`: root `types.ts` for the contract, `schemas.ts`
  for persisted JSON, repository classes for file I/O, service classes for
  domain behavior, and short file/class comments that explain ownership.
