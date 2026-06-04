# CLI V2 Command Boundary

`src/cli-v2/commands` owns terminal command bootstrap for the v2 command-line
surface. It is the command edge, not a domain-policy layer.

This README records the command-edge contract now that the legacy `src/cli/chat`
tree is retired.

## Boundary Rules

- TUI/client code under `src/cli-v2` consumes shared API clients and must not
  import core services, server controllers, or old `src/cli/chat` modules.
- Command bootstrap code may discover or start the local control-plane server
  when a command needs runtime behavior.
- API-backed runtime commands must attach to a live server or start an embedded
  server, then continue through the shared control-plane API.
- Direct management adapters may call core/domain services directly only when
  the domain has an explicit public service contract.
- Direct management adapters parse flags, call one owning service/API contract,
  and format terminal output. They must not duplicate storage access, fallback
  rules, validation semantics, workspace resolution, or domain policy.
- Long-running runtime ownership belongs to the control-plane server lifecycle,
  not to terminal command handlers.
- Command modules should expose a real `*CommandEdgeService` that owns parsing
  orchestration and output behavior. The name is intentional: command edges are
  client interaction adapters, not domain-policy owners. Do not add top-level
  helper functions or one-line forwarding wrappers when an edge service can make
  the boundary explicit.

## Direct Service Contract Checklist

Before a `cli-v2` command calls a core/domain service directly, the owning
domain should have:

- a nearby `README.md` explaining responsibility, boundaries, public adapter
  methods, and owned policy;
- type-level input/output contracts for the command-facing method;
- comments on public methods when adapter intent is not obvious from naming;
- tests proving the command delegates to the service instead of reimplementing
  the service's policy.

## Command Classification

| Command | Current implementation | Target boundary |
| --- | --- | --- |
| `heddle`, `heddle chat`, `heddle chat-v2` | Already routed to `cli-v2`; attach to a live server or start an embedded control-plane server. | Keep as the reference API-backed runtime command pattern. |
| `heddle chat-v1` | Removed from the public CLI route; the command edge reports a migration error instead of falling through to `ask`. | Keep the removed-command guard so retired names do not silently become prompts. |
| `heddle ask` | `cli-v2` command adapter attaches/embeds the control-plane server, selects or creates a session, and submits through session APIs. | API-backed runtime command. Keep one-shot asks on the same session/run path as TUI and web. |
| Unknown first argument fallback | Unknown non-command text becomes `ask`; removed command names are blocked explicitly. | Keep only if documented as shorthand; do not let retired command names become prompts. |
| `heddle daemon` | `cli-v2` command adapter over runtime discovery and `src/server` lifecycle. | Direct discovery/lifecycle calls remain acceptable because the command manages the server. |
| `heddle auth` | `cli-v2` command adapter delegates credential status/login/logout semantics to `ProviderCredentialCommandService`. | Direct management adapter over the core auth command service. |
| `heddle init` | `cli-v2` command adapter delegates `.heddle/config.json` path/default/template behavior to `ProjectConfigService`. | Direct management adapter over the core project-config service/schema contract. |
| `heddle memory status/list/read/search` | `cli-v2` command adapter over documented memory catalog and visibility services. | Direct management adapter calling documented memory service contracts. |
| `heddle memory init/validate/maintain` | `cli-v2` command adapter over documented memory validation and maintenance services. | Direct management adapter; command edge owns terminal formatting and explicit maintainer credential selection only. |
| `heddle heartbeat task ...` | `cli-v2` command adapter attaches/embeds the control-plane server and calls heartbeat task API procedures. | API-backed management command; command code must not own task/schedule mutation policy. |
| `heddle heartbeat runs ...` | `cli-v2` command adapter reads heartbeat run views through control-plane API procedures. | API-backed read command using the same run view shape as web-v2. |
| `heddle heartbeat run` | `cli-v2` command adapter requests task execution or due-task execution through the live/embedded control-plane server. | Server-backed runtime command; no local CLI scheduler worker. |
| `heddle heartbeat start` | `cli-v2` command adapter creates/updates a task through API and reports the server-backed scheduler. Embedded mode keeps the control-plane server alive until Ctrl+C. | Server-backed lifecycle command; do not run a separate CLI scheduler loop. |
| `heddle eval` | `cli-v2` command adapter over core eval harness modules. | Direct dev/management adapter unless remote/API evals become a product goal. |

## Migration Order

1. Keep `src/cli/main.ts` as the package bin entrypoint while `cli-v2`
   continues to own terminal behavior.
2. Keep direct management adapters such as `auth`, `init`, `memory`, and
   `eval` behind documented service contracts.
3. Keep heartbeat task/run/start behavior on server-backed heartbeat APIs or
   explicit heartbeat service contracts.

## Import Boundary

Import-boundary tests should keep this distinction explicit:

- `src/cli-v2/commands` may use runtime discovery, server lifecycle bootstrap,
  shared client APIs, and documented management service contracts.
- `src/cli-v2` TUI/client state, hooks, services, and components must remain
  API-only for runtime behavior.
- No `cli-v2` code should import old `src/cli/chat`.
