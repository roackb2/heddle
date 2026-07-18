# Durability Support Matrix

Heddle does not make every runtime surface durable across replicas. A host
should choose the smallest durability promise its users need, then persist only
the state required to keep that promise truthful.

This guide is the adopter-facing support matrix. For implementation ownership,
file behavior, corruption handling, and known atomicity/retention gaps, read the
contributor-facing [durable-state inventory](../../architecture/durable-state.md).

## Promise Levels

| Level | User-visible promise | Current Heddle support |
| --- | --- | --- |
| **Local durable** | Completed conversations survive browser refresh and process restart on one host | Supported by the default file repositories when `stateRoot` is on a persistent local filesystem |
| **Completed-conversation durable** | After a turn finishes, another process or replica can reopen the conversation and continue with the same compacted context | Supported when the host configures remote session and archive repositories together through `persistence.conversations` and durably commits any product-owned result before reporting success |
| **Durable in-flight execution** | A run, approval wait, cancellation handle, and event replay survive the executor process dying | **Not provided.** Active runs, pending approvals, cancellation, and replay buffers are process-local; this requires host-selected queue/orchestration infrastructure and idempotent execution design |

The completed-conversation level is a valid production boundary. A product does
not need durable in-flight execution merely because it runs more than one
replica. It must instead report process loss honestly and let the user retry
from the last completed durable state.

## State Surface Matrix

| Surface | Default behavior | Host extension today | Same-host restart | New replica or machine | Supported posture |
| --- | --- | --- | --- | --- | --- |
| Conversation sessions | Atomic local catalog with immutable revision bodies | Async `ChatSessionRepository` with revisions, stable pagination, strict records, and conformance scenarios | Yes, with persistent `stateRoot` | Yes, with a scope-bound remote repository | **Remote-ready** |
| Compaction archives | Locked, atomic local manifest append with immutable content | Async `ChatArchiveRepository`; one append owns exact messages, rolling summary, and manifest | Yes, with persistent `stateRoot` | Yes, with a scope-bound remote repository paired with the session repository | **Remote-ready** |
| Product catalog, transcript, and canonical result | Outside Heddle ownership | The host persists its user-facing view and domain result | Host-defined | Host-defined | **Host responsibility** for a truthful product success promise |
| Result artifacts | Local catalog, text content, and current pointers | Synchronous `ArtifactRepository` | Yes, with the same artifact root | Not guaranteed; a custom synchronous store is not a remote-ready contract | **Host-replaceable, local-biased** |
| Raw turn traces | Local files referenced by a local path | No general persistence port | Files survive on the same storage | No | **Local diagnostic evidence** |
| Memory notes and maintenance | Workspace files and JSONL under the state root | No general persistence port | Yes | Only when the workspace itself is copied or mounted | **Workspace-local by design** |
| Remembered approvals and project config | Workspace policy files | No general persistence port | Yes | Only with operator-controlled workspace state | **Workspace-local security policy** |
| Heartbeat tasks and checkpoints | Local task, checkpoint, and run files | Async `HeartbeatTaskStore` for custom scheduler calls, without revisions or distributed leases | Yes | Not guaranteed; the built-in scheduler is not a distributed exactly-once service | **Host-replaceable scheduler primitive** |
| MCP and skill activation | Local config, consent metadata, source paths, and a rebuildable MCP catalog | Synchronous MCP and skill activation stores | Yes | Not generally portable because records can refer to local sources | **In-process host-replaceable** |
| Custom-agent definitions | Project, user, and built-in source files; accepted turns retain a snapshot | No generic definition store | Yes | Project definitions only when project files follow the host; user definitions remain machine-local | **Source configuration** |
| Session image uploads | Local files addressed by absolute paths | No general upload repository | Yes, with the same state root | No | **Host must add object storage** if uploaded inputs must follow a replica |
| Provider credentials and browser profiles | Protected machine files and browser user-data directories | Explicit credentials may be supplied per run | Yes, on the same machine | No; re-provision credentials and browser state deliberately | **Machine-local secret/session state** |
| Runtime workspace and daemon catalogs | Absolute paths, local endpoint, PID, and liveness facts | No general persistence port | Yes, but liveness is re-evaluated | No; these records describe one machine | **Machine-local discovery** |
| Logs, layout snapshots, browser evidence, and eval output | Local diagnostic files | Host-selected logging/diagnostic infrastructure | Files survive on the same storage | No Heddle portability promise | **Diagnostic** |
| Active runs, SSE replay, cancellation, pending approvals, browser windows, and scheduler handles | In-memory coordination | No durable execution port | No | No | **Process-local** |

## Minimum Hosted Conversation Promise

To promise that a user can return to a completed conversation and continue it
after a server replacement, a host needs all of the following:

1. **One conversation persistence capability.** Configure
   `persistence.conversations` with both repositories. Heddle exposes a
   readiness report that detects incomplete/legacy configuration and enumerates
   the remaining host checks; it does not certify infrastructure.
2. **Remote session records.** Bind `ChatSessionRepository` to a trusted
   server-side identity scope and pass the repository conformance suite in the
   host's integration environment.
3. **Remote compaction archives.** Bind `ChatArchiveRepository` to the same
   identity scope and make each archive append transactional. This is required
   whenever a conversation may compact; session JSON alone cannot reconstruct
   removed exact history or the rolling summary.
4. **Durable product truth.** If a turn changes host-owned domain state, persist
   the canonical result before publishing terminal success. A durable
   conversation that claims an output changed while the product still stores
   the old value is not a successful durability design.
5. **Durable user-facing projection when needed.** If the UI exposes a catalog
   or safe transcript, persist that product view separately instead of treating
   Heddle's complete model/tool record as a stable browser contract.
6. **Identity, deletion, and operations.** Enforce tenant isolation in the
   adapter factory and database, define cascade/retention behavior, and own
   migrations, backups, monitoring, and disaster recovery.
7. **Truthful interruption behavior.** If the executor dies before finalization,
   report the run as interrupted or failed. Do not reconstruct and replay a
   pending tool call or approval from partial evidence.

For implementation guidance, see [durable session storage](session-storage.md)
and the runnable
[PostgreSQL + Drizzle reference](../../../examples/sdk/06-postgres-drizzle-storage/README.md).

## What This Promise Does Not Require

A completed-conversation promise does not by itself require:

- remote Heddle artifacts when the product already persists the canonical
  user-owned result;
- raw trace portability or cross-replica log lookup;
- remote Heddle memory notes;
- durable approval waits, SSE replay, cancellation, or active-run recovery;
- replicated MCP/skill activation, browser profiles, or provider credentials;
- distributed heartbeat scheduling; or
- one universal storage abstraction for unrelated domains.

Add one of those only when it becomes user-facing product state, an operational
requirement, or a repeated host need. Its contract should stay with the owning
domain rather than being folded into conversation storage.

## Choosing A Deployment Posture

| Product need | Recommended setup | Honest limitation |
| --- | --- | --- |
| Local tool or single durable server | Default file repositories on a persistent local volume with backup | A new machine needs the same restored volume |
| Hosted product where completed work must follow users | Remote session and archive repositories plus host-owned product persistence | An executor death can interrupt the current run |
| Product requiring uninterrupted jobs across executor death | External durable queue/workflow engine, idempotent tool effects, durable approvals/cancellation, and result finalization designed by the host | This is a larger distributed-execution system, not enabled by repository injection alone |

## Acceptance Checklist

Before claiming completed-conversation durability, verify:

- refresh restores the selected conversation, user-facing projection, and
  canonical product result;
- a fresh server process can continue the same conversation;
- a different replica can continue it using only authenticated durable state;
- forced compaction survives a fresh process and restores the rolling summary;
- two writers cannot silently overwrite a newer session or product result;
- a failed archive or product commit cannot publish terminal success;
- another identity cannot list, read, mutate, or delete the conversation;
- deletion removes or intentionally retains every user-owned record according
  to documented policy; and
- executor death is presented as interruption, not as completed durable work.

Once this checklist passes, durability is sufficient for the
completed-conversation promise. Improving unrelated local state can continue
as Heddle core work without blocking the host product.
