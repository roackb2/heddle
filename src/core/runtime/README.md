# Runtime

The runtime domain owns host-facing execution entry points and durable runtime
coordination that sit around the lower-level agent loop.

## Owns

- Programmatic run entry points such as `runAgentLoop`.
- Host-facing `AgentLoopEvent` shapes and checkpoint state.
- Provider credential resolution for runtime execution.
- Default runtime tool bundle assembly.
- Heartbeat execution, heartbeat task stores, scheduler helpers, and heartbeat
  host views.
- Workspace and daemon/runtime-host registration helpers.

## Does Not Own

- Model/tool step mechanics inside a run. Those live in `src/core/agent`.
- Persisted chat session semantics, compaction, and turn persistence. Those live
  in `src/core/chat`.
- Individual tool behavior. That lives in `src/core/tools`.
- TUI, web, server route, or browser-specific presentation logic.

## Public Entry Points

- `agent-loop.ts`: evented programmatic run wrapper around `runAgent`.
- `events.ts`: runtime event and checkpoint types.
- `default-tools.ts`: default tool bundle assembly.
- `heartbeat.ts`, `heartbeat-store.ts`, `heartbeat-task-store.ts`,
  `heartbeat-scheduler.ts`: heartbeat execution and durable scheduling.
- `workspaces.ts`, `runtime-hosts.ts`, `daemon-registry.ts`: workspace/runtime
  host coordination.
- `api-keys.ts`: provider credential source resolution.

## Extension Points

- Add new host-facing runtime events in `events.ts` only when they describe
  stable integration behavior.
- Add heartbeat storage or scheduler variants behind typed interfaces rather
  than branching inside existing stores.
- Add default tool groups through toolkit composition once the tool-domain
  refactor lands; until then keep `createDefaultAgentTools` stable.

## Common Changes

- To add a new low-level run lifecycle event, update `AgentLoopEvent`, emit it in
  `agent-loop.ts`, and add tests that assert the event ordering.
- To add heartbeat behavior, prefer adding a pure helper or store method in the
  heartbeat files before changing CLI/control-plane adapters.
- To adjust model credential resolution, update `api-keys.ts` and add provider
  credential tests.

## Tests

- `src/__tests__/integration/core/agent-loop.test.ts`
- `src/__tests__/integration/core/heartbeat-scheduler.test.ts`
- `src/__tests__/integration/core/provider-credentials.test.ts`
- `src/__tests__/integration/server/runtime-hosts.test.ts`
- `src/__tests__/integration/server/daemon-registry.test.ts`

## Notes For Coding Agents

- Keep this domain UI-free. Do not import from `src/cli`, `src/web`, or
  `src/server`.
- `runAgentLoop` is the public single-run embedding API; do not couple it to chat
  sessions.
- Preserve `AgentLoopEvent` compatibility. External hosts and examples consume
  these events.

