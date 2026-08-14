# Durable State Implementation Tracker

Last reviewed: **2026-08-14**

This is the human-readable delivery tracker for Heddle durability. It answers
"what exists now, what has been selected, and what is still only a design
idea?" The machine-readable
[`durable-state-surfaces.json`](durable-state-surfaces.json) is the fail-closed
inventory used by repository verification. The longer
[`durable-state.md`](durable-state.md) explains the invariants and lifecycle
assumptions behind each row.

This tracker is backend-neutral. PostgreSQL support is tracked separately in
[`packages/postgres/durable-port-support.json`](../../packages/postgres/durable-port-support.json).
A row appearing here does not imply that PostgreSQL, S3, or another official
adapter has been selected.

## Status vocabulary

### Contract status

| Status | Meaning |
| --- | --- |
| `public-port` | A supported, technology-neutral injected contract exists. |
| `internal-port` | An injectable contract exists but is not a curated public persistence capability. |
| `proposed-port` | The need is selected, but the contract and conformance suite have not landed. |
| `public-data` | The data shape is public, but no repository contract is promised. |
| `no-port` | The current implementation has no general injected durability boundary. |
| `external` | The product or operator owns the state outside Heddle. |

### Official adapter status

| Status | Meaning |
| --- | --- |
| `available` | An official adapter exists today, possibly under a current v5 package. |
| `selected-not-implemented` | A concrete official adapter has been selected but has not shipped. |
| `not-selected` | No official backend has been selected. |
| `not-applicable` | An official Heddle persistence adapter would violate the ownership boundary. |

`done` in this document means the contract, implementation, conformance,
package release, and fresh consumption evidence required by that row all exist.
A merged design or private skeleton is not an implemented adapter.

## Selected architecture

- Domain contracts are purpose-named and own semantics: identity, scope,
  atomicity, fencing, conflict behavior, retention hooks, serialization, and
  conformance.
- Concrete adapter packages are technology-named because their drivers,
  migrations, consistency limits, deployment requirements, and operations are
  materially different. `@heddleagent/postgres` is therefore the right name
  for PostgreSQL adapters; possible future object and telemetry packages would
  use names such as `@heddleagent/s3` and `@heddleagent/opentelemetry` only after
  a real supported surface is selected.
- A repository does not prescribe a database. A domain repository may use a
  transactional database, object storage, or a reviewed hybrid. A hybrid writes
  immutable content first and commits its authoritative manifest/reference
  second, so failure can orphan content but cannot publish a missing object.
- A managed session filesystem is continuity storage. Provider expiry,
  runtime-version replacement, corruption, or deletion can still remove it.
  Long-lived product promises therefore need continuously committed domain
  records or versioned portable checkpoints outside that filesystem.
- Heddle does not have one serializable "state." Conversation truth, memory,
  approval policy, credentials, telemetry, workspace files, and live execution
  have different owners and must not be recursively uploaded as one `.heddle`
  snapshot.

## Surface tracker

| ID | State surface | Current boundary | Official adapter | Selected next gate |
| --- | --- | --- | --- | --- |
| `conversation-sessions` | Conversation sessions | `public-port`; remote-ready | PostgreSQL selected, not implemented | Implement scoped real-PostgreSQL conformance with archives. |
| `conversation-archives` | Compaction archive manifest and content | `public-port`; remote-ready | PostgreSQL selected, not implemented | Implement atomic append under the same scope as sessions; keep hybrid object content behind the domain contract. |
| `result-artifacts` | Artifact catalog and content | `public-port`; local-biased | Not selected | Redesign atomic metadata/content, deletion, retention, and remote conformance first. |
| `raw-turn-traces` | Raw turn traces | `public-data`; workspace diagnostic | Not selected | Select a sink only from a concrete lookup and retention need. |
| `memory-notes-maintenance` | Human-editable memory and maintenance records | `no-port`; workspace canonical state | Not selected; design gap is active | Define a memory-owned portable repository or checkpoint with versioning, CAS/conflict behavior, deletion, retention, and secret exclusion. |
| `remembered-approvals` | Remembered approval policy | `no-port`; workspace security policy | Not applicable | Keep operator-controlled unless a separate portable security model is selected. |
| `project-config` | Project runtime/autonomy configuration | `no-port`; workspace canonical state | Not applicable | Keep with the operator-controlled project unless policy distribution is selected. |
| `mcp-config` | MCP configuration | `internal-port`; host-replaceable | Not selected | Define portable identity and secret-reference semantics before a remote adapter. |
| `mcp-activation` | MCP activation and consent | `internal-port`; host-replaceable | Not selected | Define portable identity and consent policy independently of config and cache. |
| `mcp-discovery-catalog` | MCP discovery catalog | `internal-port`; rebuildable continuity cache | Not selected | Keep rebuildable cache semantics separate from authority. |
| `agent-skill-activation` | Agent-skill activation metadata | `public-port`; local-biased | Not selected | Model portable project/user/built-in skill sources before remote storage. |
| `custom-agent-definitions` | Custom-agent definitions | `no-port`; project/user source files | Not selected | Define portable source identity before a repository. |
| `heartbeat-task-authority` | Heartbeat tasks, checkpoints, and run records | `public-port`; host-replaceable | Official PostgreSQL adapter exists in v5 | Move once to v6 without weakening claims, fencing, recovery, or conformance. |
| `standalone-heartbeat-checkpoint` | One-off heartbeat checkpoint | `public-port`; host-replaceable | Not selected | Require a concrete identity/conformance need; scheduled durability stays with task authority. |
| `browser-settings-profiles` | Browser settings, profiles, locks, endpoints | `no-port`; machine secret/session state | Not applicable | Re-provision per machine; never copy as generic state. |
| `runtime-workspace-catalog` | Runtime workspace catalog | `no-port`; machine discovery | Not applicable | Rediscover/reconfigure absolute paths per machine. |
| `daemon-registry` | Daemon/process registry | `no-port`; machine discovery | Not applicable | Re-evaluate local liveness; never restore PIDs or endpoints as authority. |
| `provider-credentials` | Provider credentials | `no-port`; machine secret state | Not applicable | Re-provision through a secret system or explicit run credentials. |
| `session-image-uploads` | Session image uploads | `no-port`; workspace input files | Not selected | Define content identity, object access, deletion, and retention before object storage. |
| `diagnostic-output` | Logs, evidence, layout snapshots, evaluation output | `no-port`; diagnostic files | Not selected | Select domain-specific sinks only from explicit operational requirements. |
| `active-run-coordination` | Replay, subscribers, cancellation, approvals, windows, handles | `no-port`; process coordination | Not selected | Requires a workflow/queue, idempotency, and side-effect design, not a storage adapter. |
| `execution-host-conversation-lifecycle` | Requested/accepted/terminal invocation lifecycle | `proposed-port`; no released implementation | PostgreSQL selected, not implemented | Merge/release generic lifecycle contract and conformance, then implement the SQL adapter. |
| `workspace-continuity-checkpoints` | Allowlisted portable workspace/domain checkpoints | `no-port`; acknowledged continuity gap | Not selected | Start with memory-specific recovery; define versioned manifest, checksums, generation fencing, size and sensitive-field exclusions. |
| `normalized-llm-usage` | Normalized model usage/cost metadata | `public-data`; embedded in owning records | Not applicable | Keep with conversation/heartbeat records unless billing or budget ledger semantics are selected. |
| `control-plane-audit-events` | Privileged control-plane audit | `public-data`; operator sink | Not applicable | Host binds audit/SIEM retention; widen only through compatibility/security review. |
| `telemetry-events` | Logs, traces, metrics, activity | `public-data`; local/host sink | Not selected | Select stable signals, correlation, redaction, backpressure, and delivery semantics before an official exporter. |
| `product-canonical-truth` | Product catalog, user transcript projection, canonical result | `external`; product-owned | Not applicable | Product persists its own identity, relationships, results, and retention before publishing success. |

## Active implementation items

| Work item | Status | Dependency | Done when | What is not part of this item |
| --- | --- | --- | --- | --- |
| `PACKAGE-FOUNDATION-001` | `in_review` | Draft PR #341 | Five private package identities, complete backend-neutral inventory, separate PostgreSQL matrix, and fail-closed verification pass review | No code move, publication, or deprecation |
| `HOST-LIFECYCLE-001` | `in_review` | Draft PR #340 | Generic lifecycle service/port, ordering and fencing conformance, release, and fresh adopter consumption | No Lucid schema, retention policy, UI, or product history |
| `POSTGRES-CONVERSATIONS-001` | `blocked` | Package foundation plus activated v6 runtime contracts | Sessions and archives pass real-PostgreSQL isolation, atomicity, reconnect, migration, and conformance gates | No product transcript/result tables |
| `POSTGRES-HOST-LIFECYCLE-001` | `blocked` | Released `HOST-LIFECYCLE-001` | Official adapter, migrations, fencing/expiry tests, real-store conformance, and release | No Execution Host process or product database |
| `MEMORY-PORTABILITY-001` | `active-design` | Foundation review | Included memory records, versioned encoding, validation/corruption behavior, CAS/conflict policy, size, retention/deletion, secret exclusions, restore timing, and cross-adapter fixtures are approved | No whole-state-root snapshot, credentials, approval policy, active execution, or provider-specific public contract |
| `WORKSPACE-CHECKPOINT-001` | `deferred` | A product promise that must survive session expiry/runtime replacement beyond memory | Allowlisted domain manifest, immutable objects, committed generation, integrity, compatibility, GC, and recovery evidence exist | No blind `.heddle` archive or process resurrection |
| `TELEMETRY-EXPORT-001` | `deferred` | Stable signal/redaction/delivery requirements | Standard exporter integration and failure/backpressure tests exist | No telemetry restoration or product billing ledger |
| `DURABLE-EXECUTION-001` | `deferred` | Explicit durable workflow product requirement | Queue/workflow authority, idempotency, cancellation, approvals, replay, fencing, and side-effect semantics are proven | No claim that PostgreSQL rows or filesystem snapshots resume execution |

## Memory and expiring session storage

[AWS currently documents AgentCore managed session storage](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-filesystem-configurations.html)
as resetting after 14 idle days and on a Runtime version update. Such a session
filesystem still needs serialization if the product promise outlives either
boundary. The selected posture is:

1. Use the managed session filesystem as the live, write-back working copy for
   source files, dependencies, caches, and local memory files during ordinary
   stop/resume.
2. Commit correctness-critical conversation, lifecycle, and heartbeat records
   continuously through their domain repositories; do not wait for microVM
   shutdown.
3. Design a memory-owned portable checkpoint/repository. Hydrate it into an
   empty scoped workspace on cold start and checkpoint at explicit memory
   mutation/maintenance boundaries or a bounded interval.
4. Treat termination-time upload as best-effort final flushing only. A crash,
   timeout, provider eviction, or network loss may skip it.
5. Never restore active runs, pending approvals, locks, PIDs, sockets,
   credentials, browser profiles, or absolute machine paths from that memory
   checkpoint.

Object storage is a likely adapter for immutable checkpoint generations, but
the memory contract comes first. Naming it `S3MemoryStore` at the domain layer
would prevent a filesystem, another object store, or a future database adapter
from satisfying the same semantics.

## Update protocol

When a durability surface changes:

1. update `durable-state-surfaces.json` in the same change;
2. update the matching row and active item here;
3. update `durable-state.md` when ownership, lifecycle, or invariants change;
4. update a technology package matrix only when that backend's decision changes;
5. add conformance and real-backend evidence before changing an adapter to
   `available`; and
6. distinguish design, merged code, published package, deployed use, and live
   verification. Never infer one from another.
