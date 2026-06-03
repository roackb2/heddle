# CLI V2 Command Boundary

`src/cli-v2/commands` owns terminal command bootstrap for the v2 command-line
surface. It is the command edge, not a domain-policy layer.

This README records the migration contract for moving remaining terminal
commands out of the legacy `src/cli` tree before CLI v1 is removed.

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
| `heddle chat-v1` | Explicit legacy fallback through `src/cli/chat`. | Keep only while CLI v1 remains available; delete during v1 retirement. |
| `heddle ask` | Hybrid path: local conversation engine when no server exists, session API when a live server exists. | API-backed runtime command. Attach/embed the control-plane server, then use session APIs so one-shot asks match TUI/web behavior. |
| Unknown first argument fallback | Unknown command currently becomes `ask`. | Decide explicitly. Keep only if documented as shorthand; otherwise remove before v1 retirement. |
| `heddle daemon` | Adapter over runtime discovery and `src/server` lifecycle. | Move command ownership here. Direct discovery/lifecycle calls remain acceptable because the command manages the server. |
| `heddle auth` | `cli-v2` command adapter delegates credential status/login/logout semantics to `ProviderCredentialCommandService`; `src/cli/auth.ts` remains only as removable v1 compatibility. | Direct management adapter over the core auth command service. |
| `heddle init` | `cli-v2` command adapter delegates `.heddle/config.json` path/default/template behavior to `ProjectConfigService`. | Direct management adapter over the core project-config service/schema contract. |
| `heddle memory status/list/read/search` | Direct memory visibility/catalog service calls implemented inline in `src/cli/main.ts`. | Direct management adapter calling documented memory service contracts. |
| `heddle memory init/validate/maintain` | Direct core memory services; maintenance resolves model/credentials locally. | Direct management adapter, once memory README/public methods explicitly cover validation, repair, backlog, and credential expectations. |
| `heddle heartbeat task ...` | `cli-v2` command adapter attaches/embeds the control-plane server and calls heartbeat task API procedures. | API-backed management command; command code must not own task/schedule mutation policy. |
| `heddle heartbeat runs ...` | `cli-v2` command adapter reads heartbeat run views through control-plane API procedures. | API-backed read command using the same run view shape as web-v2. |
| `heddle heartbeat run` | `cli-v2` command adapter requests task execution or due-task execution through the live/embedded control-plane server. | Server-backed runtime command; no local CLI scheduler worker. |
| `heddle heartbeat start` | `cli-v2` command adapter creates/updates a task through API and reports the server-backed scheduler. Embedded mode keeps the control-plane server alive until Ctrl+C. | Server-backed lifecycle command; do not run a separate CLI scheduler loop. |
| `heddle eval` | Local eval harness adapter over core eval modules. | Direct dev/management adapter unless remote/API evals become a product goal. |

## Migration Order

1. Move command modules into `src/cli-v2/commands` while leaving
   `src/cli/main.ts` as a temporary delegating entrypoint.
2. Convert `ask` to an API-backed runtime command.
3. Move low-risk direct management adapters such as `auth`, `init`, `memory`,
   and `eval` behind documented service contracts.
4. Move heartbeat task/run/start behavior behind server-backed heartbeat APIs or
   explicit heartbeat service contracts.
5. Delete `chat-v1`, `src/cli/chat`, and legacy command tests/docs once no
   production command depends on them.

## Import Boundary

Import-boundary tests should keep this distinction explicit:

- `src/cli-v2/commands` may use runtime discovery, server lifecycle bootstrap,
  shared client APIs, and documented management service contracts.
- `src/cli-v2` TUI/client state, hooks, services, and components must remain
  API-only for runtime behavior.
- No `cli-v2` code should import old `src/cli/chat`.
