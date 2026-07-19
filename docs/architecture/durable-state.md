# Durable State

This document inventories Heddle's durable state boundaries. It answers four
questions for each state surface:

1. Which domain owns its persisted meaning?
2. What survives a browser refresh, process restart, or host replacement?
3. Which storage boundary can a programmatic host replace today?
4. What corruption, atomicity, retention, or security constraints still apply?

The inventory describes the post-`v5.1.0` implementation. Update it when adding
a production writer, changing a persisted schema, or widening a repository
contract.

For the shorter adopter-facing decision guide, see the
[durability support matrix](../guides/programmatic/durability-support.md).

## Terms

The labels in this document are deliberately narrower than "persistent":

- **Remote-ready**: Heddle exposes an asynchronous, host-injectable repository
  contract whose semantics are defined independently of the default file
  adapter. A remote adapter still owns authentication, tenant scope, schema,
  migrations, transactions, backups, and operations.
- **Host-replaceable**: a host can inject another implementation, but the
  current contract is synchronous or otherwise shaped around local storage.
  This is not a remote-storage guarantee.
- **Workspace-local**: files belong to one workspace or state root. They survive
  a process restart when that filesystem survives, but do not follow a new
  replica unless the workspace storage is mounted or copied.
- **Machine-local**: data represents one machine's credentials, paths, browser
  profile, or process discovery state. It should not be copied to another host
  by a generic persistence layer.
- **Diagnostic**: durable evidence or developer output, not authoritative
  product recovery state.
- **Process-local**: coordination held only in memory. Losing it interrupts the
  operation even when related durable records remain.

"Host replacement" below means a new process on a different machine or
ephemeral replica without the old local filesystem. A shared volume counts as
the same storage, not as remote portability.

## Lifecycle Matrix

| State surface | Current class | Browser refresh | Same-filesystem process restart | Host replacement | Delete and retention behavior |
| --- | --- | --- | --- | --- | --- |
| Conversation sessions | **Remote-ready** | Reloaded from the repository | Survives; stale local leases can be recovered | Survives when the host supplies the same remote repository and authenticated scope | Session delete is revision-checked; default files retain superseded and interrupted revision bodies |
| Conversation archives | **Remote-ready** | Reloaded through the session manifest | Survives | Survives when the host supplies the same remote archive repository and scope | Append-only today; default files can retain orphan content and have no archive GC policy |
| Result artifacts | **Host-replaceable** | Reloaded from catalog and content keys | Survives with the same artifact root | Only if a custom synchronous repository reaches shared storage; not a remote-ready promise | No public delete, retention, or orphan cleanup contract |
| Raw turn traces | **Workspace-local diagnostic** | Existing trace files remain | Survives | Does not follow the session unless state storage is shared or copied | No retention or GC policy; session summaries can retain a local-only `traceFile` locator |
| Memory notes and maintenance records | **Workspace-local** | Reloaded from `.heddle/memory` | Survives | Only when the workspace files are mounted, copied, or intentionally synchronized | Human-editable notes plus append-only maintenance JSONL; no general retention policy |
| Remembered approvals and project config | **Workspace-local security policy** | Reloaded from the state root | Survives | Only with the workspace; copying changes the receiving host's policy | Approval rules can be replaced by the owning service; there is no cross-domain cascade |
| MCP config, activation, and discovery catalog | **Host-replaceable (sync); workspace-local default** | Reloaded; catalog is a cache | Survives | Only with the workspace; the catalog may be rebuilt | No universal cleanup; discovery catalog is disposable, config and activation are authoritative |
| Skill activation | **Host-replaceable (sync); workspace-local default** | Reloaded | Survives | Only with the state root; referenced user skill paths may not exist | No generic pruning of stale source paths |
| Custom-agent definitions | **Workspace or machine source config** | Rediscovered from source files | Survives | Project definitions follow copied project files; user definitions do not | Project definitions have explicit create/delete; accepted turns persist an immutable execution snapshot |
| Heartbeat tasks, checkpoints, and run records | **Host-replaceable async scheduler store; workspace-local built-in** | Reloaded through the control plane | Survives; scheduler execution itself restarts | Only a custom store can follow a new host, and Heddle defines no distributed scheduler guarantee | Deleting a file-backed task removes its task, checkpoint, and matching run-record files; no age-based retention |
| Browser settings and profiles | **Machine-bound workspace state** | Reloaded; an open window remains server-owned | Settings and profile files survive, open windows and locks do not | Not portable by contract; browser profile data and local CDP endpoints are machine-specific | No profile/evidence retention policy |
| Runtime workspace catalog | **Machine-local** | Reloaded | Survives | Not portable: records contain absolute local paths | No automatic pruning of moved or deleted workspaces |
| Daemon registry | **Machine-local process discovery** | Reloaded | Survives as a registry file, but liveness is re-evaluated by timestamp and PID | Must not be copied; endpoints and PIDs are local facts | Live server registration is cleared by owner; known workspace records are not automatically pruned |
| Provider credentials | **Machine-local secret store** | Server-side store is unaffected | Survives with mode `0600` | Must be re-provisioned or supplied explicitly; never migrate through generic state sync | Per-provider removal exists; malformed storage fails to an empty store |
| Session image uploads | **Workspace-local input files** | Existing absolute paths remain usable on the same host | Survives | Does not follow a remote session unless separately copied | No session-delete cascade or retention policy today |
| Logs, layout snapshots, browser evidence, and eval output | **Diagnostic** | Files remain, but are not UI recovery state | Files survive | No portability contract | Eval output has explicit cleanup; other diagnostics have no shared retention policy |
| Active runs, replay buffers, subscribers, pending approvals, browser windows, and scheduler handles | **Process-local** | Browser clients can reconnect only while the owning server still has the run | Lost and treated as interrupted | Lost | Removed when the process/run closes; there is no durable in-flight recovery |

## Current Extension Surfaces

An injected TypeScript interface is not automatically a production remote
storage contract. The current extension surface is:

| Domain | Injected surface | I/O and consistency shape | Current remote posture |
| --- | --- | --- | --- |
| Conversations | `persistence.conversations`, containing `ChatSessionRepository` plus `ChatArchiveRepository` | Revisioned session CRUD/pagination plus atomic archive content/summary/manifest append | **Remote-ready as one capability** when the host binds both ports to the same authenticated scope and completes the readiness checks |
| Artifacts | `ArtifactRepository` on the conversation engine | Synchronous catalog and text-content calls; no atomic catalog/content commit | **Host-replaceable**, not remote-ready |
| Heartbeat | `HeartbeatTaskStore` passed to `runDueTasks` or `runLoop` | Async tasks/checkpoints/runs, but no revisions, distributed lease, multi-record transaction, or conformance suite; built-in `start` constructs the file service | **Host-replaceable scheduler primitive**, not a distributed durability promise |
| MCP | `McpConfigStorePort`, `McpActivationStorePort`, and `McpCatalogStorePort` | Synchronous whole-document stores; activation/config authority differs from rebuildable discovery cache | **Host-replaceable for an in-process host**, not remote-ready |
| Skill activation | `AgentSkillActivationStorePort` | Synchronous consent metadata containing source paths | **Host-replaceable for an in-process host**, not portable skill storage |
| All other rows | No general injected persistence port | Domain-specific files, diagnostics, secrets, or process coordination | Local/machine/process semantics remain authoritative |

## Remote-Ready Conversation State

[`ConversationPersistence`](../../src/core/chat/engine/persistence/types.ts) groups sessions
and compacted archives as one configuration capability. The engine resolves the
pair once and exposes it at `engine.persistence.conversations` with a readiness
report. The report catches missing or ambiguous configuration and enumerates
the host-owned checks; it does not query or certify the database, auth, tenant
scope, migrations, backup, or product finalization.

The separate engine repository options remain as deprecated compatibility
inputs. A partial legacy configuration can continue operating, but it is not a
complete completed-conversation durability configuration.

### Sessions

[`ChatSessionRepository`](../../src/core/chat/engine/sessions/repository/types.ts)
is the authoritative active-session boundary. It is asynchronous and uses
optimistic revisions for create, update, and delete. Catalog ordering and cursor
pagination are part of the contract, including scope isolation and stable
ordering ties. A host binds a repository instance to an authenticated scope;
individual operations intentionally do not accept caller-provided tenant IDs.

The default
[`FileChatSessionRepository`](../../src/core/chat/engine/sessions/repository/file-chat-session-repository.ts)
stores an atomic catalog plus immutable revision bodies. It serializes writes
within a process and across processes, writes a new body before replacing the
catalog, and surfaces malformed referenced state as a storage-corruption error.
Readers therefore see either the previous complete revision or the next one.

Current limits:

- superseded and crash-orphaned revision bodies are retained;
- the repository conformance suite verifies Heddle semantics, not a host's
  authentication, row-level policy, migrations, query plans, backups, or
  disaster recovery;
- a host must keep session and archive repositories in the same identity scope.

See the repository's
[`README`](../../src/core/chat/engine/sessions/repository/README.md) for the full
contract and conformance boundary.

### Compaction archives

[`ChatArchiveRepository`](../../src/core/chat/engine/sessions/archives/types.ts)
owns compacted exact messages, rolling summaries, and archive manifests. One
successful append must make all three readable together. Locators are opaque to
the engine: the file adapter returns `.heddle/...` paths, while a database/blob
adapter can return stable repository keys.

The default
[`FileChatArchiveRepository`](../../src/core/chat/engine/sessions/archives/file-chat-archive-repository.ts)
writes immutable content first and atomically replaces the manifest under a
cross-process lock. A crash can leave unreferenced content, but cannot publish a
manifest that points to an incomplete append. Invalid or session-mismatched
manifests raise a corruption error instead of becoming empty history.

This boundary deliberately excludes raw trace storage, artifacts, memory, and
active streaming coordination. See the archive
[`README`](../../src/core/chat/engine/sessions/archives/README.md).

## Replaceable But Not Remote-Ready

### Result artifacts

[`ArtifactService`](../../src/core/artifacts/service.ts) owns artifact IDs,
catalog shape, content keys, and current-workspace/current-session pointers.
[`ArtifactRepository`](../../src/core/artifacts/types.ts) is injectable, and
custom repositories may use opaque content keys, but its API is synchronous.
The default file repository stores `artifacts.json` and text-like content under
`files/`.

Important gaps in the current file implementation:

- content and catalog/current-pointer changes are not one atomic commit;
- catalog replacement has no file or process lock, so concurrent writers can
  lose updates;
- a malformed catalog is treated as an empty store, hiding corruption;
- content is written before the catalog, so interruption can leave orphan
  files;
- there is no delete, retention, garbage-collection, large-blob, or streaming
  contract.

Artifacts are the strongest candidate for the next focused storage boundary.
That work should define asynchronous metadata and content operations, opaque
stable addresses, commit/current-pointer atomicity, and cleanup semantics. It
should not introduce a universal storage provider shared by unrelated domains.

## Workspace-Local Product State

### Memory

[`src/core/memory`](../../src/core/memory/README.md) owns human-readable durable
knowledge under `.heddle/memory`, including catalog files, notes, append-only
candidate/run records, and a maintenance lock. This is workspace knowledge, not
a transcript or application database.

Maintenance combines an in-process queue with an exclusive lock file. Invalid
JSONL entries are skipped during tolerant reads, and a process failure may leave
pending candidates or a lock until stale-lock recovery. Memory explicitly must
not contain credentials or secrets. Remote knowledge synchronization, if ever
needed, should be a separate product boundary with conflict and authority rules;
it should not be inferred from the conversation repository contract.

### Approval policy and project configuration

Remembered project approvals live in `command-approvals.json` through
[`FileProjectApprovalRuleRepository`](../../src/core/approvals/remembered-rules/repository.ts).
Malformed files fail closed to no remembered rules and log an error. Writes
replace the whole file without an atomic rename or cross-process lock.

Project settings live in `.heddle/config.json` through
[`ProjectConfigService`](../../src/core/project-config/service.ts). They include
model/runtime defaults and security-relevant autonomy policy. Missing or invalid
config resolves to an empty configuration before defaults are applied. Writes
also replace the whole file without locking. These files should move only with
an operator-controlled workspace because copying them changes execution policy.

Pending approval promises are not part of this durable state. They remain
process-local by design; a restart interrupts the waiting run. See the approvals
domain [`README`](../../src/core/approvals/README.md).

### MCP, skills, and custom agents

The MCP domain owns three different files with different authority:

- `mcp.json` is user-authored configuration and may reference environment
  variables, but must not contain resolved secrets or tokens;
- `mcp/activation.json` records operator activation decisions;
- `mcp/catalog.json` caches discovered tool metadata and may be rebuilt.

The file repositories report invalid MCP configuration as issues; invalid
activation or catalog stores fall back to empty state. All writes replace whole
files without atomic rename or locking. `McpService` can accept synchronous
store ports for all three, but their different authority and cache semantics
remain; this is not one remote MCP database contract. See
[`src/core/mcp`](../../src/core/mcp/README.md).

Skill definitions remain at their project, user, or built-in source paths.
[`FileAgentSkillActivationRepository`](../../src/core/skills/activation-repository.ts)
persists only activation/consent metadata under `skills/activation.json` and
falls back to empty state on invalid input. `AgentSkillService` accepts another
synchronous activation store, but the records still refer to project, user, or
built-in definition sources rather than storing the skill content.

Custom-agent definitions similarly remain under project or user `.agents`
directories. Project definitions have explicit create/delete behavior. An
accepted conversation turn stores an immutable execution snapshot, so later
definition edits do not change the meaning of persisted history. See
[`src/core/custom-agents`](../../src/core/custom-agents/README.md).

### Heartbeat

[`FileHeartbeatTaskService`](../../src/core/heartbeat/tasks/service.ts) is the
domain boundary for `heartbeat/tasks`, `heartbeat/checkpoints`, and
`heartbeat/runs`. Task deletion removes all three kinds of matching records.
The repository validates writes and skips unreadable task, checkpoint, or run
files during reads. One-off stored heartbeat usage has a separate
[`FileHeartbeatCheckpointRepository`](../../src/core/heartbeat/checkpoint/repository.ts)
for a caller-selected checkpoint path under the same heartbeat domain.

The exported asynchronous `HeartbeatTaskStore` can be supplied to
`HeartbeatSchedulerService.runDueTasks` and `runLoop`. It does not define
compare-and-swap task revisions, distributed execution leases, or an atomic
task/checkpoint/run transaction, and the built-in `start` path always creates
the file service. A hosted store is therefore possible for custom scheduler
code, but is not currently a remote-ready or exactly-once scheduler contract.

Writes replace individual files without atomic rename or cross-process locking.
Run filenames use a timestamp plus task ID and have no explicit collision or
age-retention policy. Scheduler handles and the currently executing cycle stay
process-local even though the task and last checkpoint are durable. See the
heartbeat [`README`](../../src/core/heartbeat/README.md).

### Browser settings, profiles, and evidence

[`src/core/browser`](../../src/core/browser/README.md) owns:

- `browser/settings.json` for the selected backend, profile, channel, display
  mode, and local CDP endpoint;
- `browser-profiles/` and `native-chrome-profiles/` for browser-managed user
  data such as authenticated cookies;
- per-run `events.jsonl`, snapshots, and screenshots when evidence recording is
  enabled.

Profile directories and loopback CDP endpoints are intentionally machine-bound
and can contain sensitive authenticated browser state. They must not be moved by
a generic workspace database adapter. Settings writes are whole-file writes;
evidence appends and snapshot writes do not define retention or remote lookup.
Open windows and profile leases are in-process coordination and disappear on
restart.

### Session image uploads

The control plane stores validated image uploads under
`uploads/sessions/<session-id>/` through
[`ChatSessionImageUploadService`](../../src/server/services/control-plane/chat-session-image-uploads.ts).
The current session/runtime consumes absolute local paths. Uploads therefore do
not become remotely available merely because the session repository is remote,
and session deletion does not currently cascade to uploaded files.

## Machine-Local State

### Provider credentials

[`ProviderCredentialRepository`](../../src/core/auth/provider-credentials.ts)
stores provider keys, bearer tokens, and OAuth tokens at `~/.heddle/auth.json`
by default. The file is forced to mode `0600`; malformed input becomes an empty
store. Explicit per-run credentials and environment variables remain separate
host inputs.

This is a secret-management boundary, not application persistence. Hosted
deployments should inject credentials through their own secret manager or
request scope. Heddle must never copy this file into a conversation database,
workspace catalog, artifact store, or diagnostic bundle.

### Workspace and daemon catalogs

[`RuntimeWorkspaceService`](../../src/core/runtime/workspaces/service.ts) owns
`workspaces.catalog.json`. Records include absolute workspace and state-root
paths, so the catalog describes one local installation. The file repository
performs whole-file writes without atomic rename or locking. Schema-invalid
catalogs normalize to a default catalog, while malformed JSON fails before that
normalization step.

[`RuntimeDaemonRegistryService`](../../src/core/runtime/daemon/registry-service.ts)
owns `~/.heddle/daemon-registry.json`: the current local server endpoint/PID and
known local workspaces. Server liveness is re-evaluated from the heartbeat age
and PID. Invalid schema normalizes to an empty registry, although malformed JSON
still fails in the repository read before normalization. The registry is local
discovery data and must not be replicated.

## Diagnostic State

- [`TraceWriter`](../../src/core/chat/engine/turns/trace/trace-writer.ts) writes
  completed-turn traces under `traces/`. A session stores a summary plus the
  local `traceFile` path. Memory maintenance can later rewrite that trace to add
  maintenance events; an unreadable trace is treated as empty before that
  rewrite. The legacy control-plane one-shot ask controller also writes directly
  into the same trace root. There is no repository port, atomic replacement,
  lock, redaction boundary, retention policy, or stable remote locator. Trace
  semantics and ordering must be designed before adding remote trace storage.
- [`createLogger`](../../src/core/utils/logger.ts) writes asynchronous Pino logs,
  normally to `logs/server.log`. Logs are operational evidence, not recovery
  state, and need host-owned rotation/redaction in production.
- [`ControlPlaneLayoutSnapshotsController`](../../src/server/controllers/trpc/control-plane/layout-snapshots.ts)
  writes JSON/PNG debugging snapshots under `debug/dom-snapshots`.
- [`BrowserEvidenceService`](../../src/core/browser/evidence/service.ts) writes
  per-run browser events, snapshots, and screenshots.
- [`src/core/eval`](../../src/core/eval/README.md) creates disposable workspaces
  and gitignored reports under `evals/results` by default. The eval cleanup
  command owns deletion. These are developer-tool outputs, not runtime state.

## Process-Local Coordination

[`ConversationRunService`](../../src/core/chat/runs/service.ts) owns active runs,
bounded replay buffers, stream subscribers, abort controllers, and pending
approval resolvers in memory. Control-plane event buses, browser windows,
profile leases, cached loggers, and heartbeat scheduler handles are also
process-local.

Persisted session leases protect accepted conversation state across competing
clients, but they do not make an in-flight model/tool execution resumable. A
process restart must be represented as interruption; replaying a pending tool
call or approval from partial durable evidence would be unsafe.

## Explicitly Excluded Writers

The production writer sweep also found file operations that are not Heddle
durable-state domains:

| Writer | Why it is excluded from storage portability |
| --- | --- |
| `src/core/tools/toolkits/coding-files` | These tools intentionally mutate user-owned workspace files. Git/filesystem semantics, not Heddle persistence, are authoritative. |
| Project/user skill and custom-agent definition services | The files are operator-authored source configuration. Their discovery and snapshot rules are inventoried above, but they are not copied into a Heddle state repository. |
| Browser driver screenshot/profile writes | The browser runtime writes into the browser evidence/profile roots owned above; the driver is not a second persistence domain. |
| Eval fixture setup and cleanup | These are bounded developer-harness workspaces and reports, not a production recovery surface. |
| Read-only awareness, file-view, and session-watch code | Filesystem access without durable writes does not create another state owner. |

Any new production writer under `src/core` or `src/server` must either join an
owner above, define a new owner and lifecycle here, or be explicitly excluded
with the same level of reasoning.

## Ranked Follow-Up

1. **Keep the adopter support matrix current.** The
   [durability support matrix](../guides/programmatic/durability-support.md)
   now distinguishes local, completed-conversation, and durable in-flight
   promises. Update it whenever an extension surface or support level changes.
2. **Design the artifact boundary only if the next host needs it.** Define an
   asynchronous metadata/content split, stable opaque addresses, atomic content
   plus current-pointer semantics, size/streaming limits, and explicit deletion
   and orphan cleanup. Add an adapter only against that domain contract.
3. **Harden local writers by domain and risk.** Use atomic replacement,
   domain-appropriate locks, and explicit corruption behavior for state whose
   concurrent loss changes user-visible truth. Do not hide this work behind a
   generic file repository wrapper.
4. **Specify trace semantics before trace portability.** Decide event ordering,
   redaction, partial-run visibility, retention, session linkage, and stable
   addressing before creating a trace port.
5. **Keep machine/security state local.** Credentials, browser profiles,
   daemon discovery, and absolute-path workspace catalogs should remain outside
   general remote persistence. Memory synchronization also requires its own
   authority/conflict design rather than reuse of the session repository.

The result is intentionally several domain-owned storage boundaries, not one
universal persistence abstraction.
