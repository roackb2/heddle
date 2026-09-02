# Working-Set Checkpoints

This module owns the portable durable contract for one agent's free-form local
working directory. It gives a hosted Runtime a canonical committed generation
that can outlive a process, microVM, or provider continuity volume without
turning the entire workspace into one persistence boundary.

## Owns

- `WorkingSetScopeId`, a deterministic opaque address derived from already
  verified adopter, tenant, subject, and stable product-session identity.
- A versioned immutable generation and authoritative manifest schema.
- Whole-generation and per-file integrity validation.
- Explicit resource bounds supplied by the host for every service instance.
- A provider-neutral manifest-last compare-and-swap store contract.
- Checkpoint, load, and validate-before-reset recovery ordering.
- A clean empty working directory when no committed generation exists.

All regular files below the selected working root are part of the checkpoint.
The root must therefore be a dedicated disposable directory and must not
contain credentials, policy, Runtime configuration, sockets, locks, caches, or
other state with a different lifecycle.

## Does Not Own

- Authentication or authorization of identity claims and checkpoint scopes.
- S3, database, or provider SDK implementation.
- The privileged operation that resets a host's local working directory.
- Tool construction, prompt policy, model behavior, or product workflows.
- Memory notes, conversation transcripts, heartbeat authority, or execution
  settlement.
- A generic workspace backup or replay of in-flight tool effects.

The Execution Host or another adopter must derive a scope only after verifying
its identity claims, bind that scope through the execution authority without
widening it, and authorize every adapter operation. The scope is an address,
not a bearer credential.

## Recovery Lifecycle

Before exposing filesystem tools for an execution:

1. Call `prepareOrRecover(scopeId)` while no other operation can mutate the
   same local working copy.
2. Heddle loads the manifest and its named immutable generation, then validates
   schema, exact scope, generation identity, canonical file order, checksums,
   path conflicts, and configured resource limits.
3. Only after durable validation succeeds, Heddle invokes the host-supplied
   `resetLocalWorkingCopy` capability.
4. Heddle does not trust callback completion as proof. The portable-directory
   restore boundary requires the root to be absent or empty before publishing
   the complete committed generation. A populated, symbolic-link, or
   non-directory target fails closed.
5. When no manifest exists, the same path publishes an empty directory.
6. Construct tools only after the promise resolves.

The reset capability is intentionally explicit because recursively removing an
arbitrary configured path is privileged host behavior. Bind it only to the
absolute, dedicated ephemeral root selected for this service. Relative paths
and filesystem roots are rejected. Do not pass a general
workspace, home directory, mounted source tree, or caller-selected path.

Runtime-local files are a disposable working copy. Recovery always discards
uncommitted local state and restores durable truth, including on warm reuse
after a failed or interrupted execution.

## Checkpoint Lifecycle

After the agent reaches a stable successful boundary, call
`checkpoint(scopeId)` before reporting terminal success to the orchestrator.
The service:

1. loads and validates the current authoritative manifest for the CAS
   expectation;
2. captures the complete local working root within the configured bounds;
3. creates a new immutable generation and integrity manifest;
4. asks the store to persist the generation and atomically advance the
   manifest from the exact expected generation.

A competing manifest change raises `WorkingSetCheckpointConflictError`.
Immutable generations may remain unreferenced after crashes or conflicts; the
adapter owns retention and garbage collection. If a commit response is
ambiguous, reload authoritative state before deciding whether to retry. Never
blindly assume failure means the manifest did not advance.

## Crash and Concurrency Semantics

Recovery is crash-idempotent under caller serialization, not an atomic
replacement of a populated directory. A crash after reset can leave the local
root absent, empty, or partially staged; the next serialized recovery validates
durable truth again, resets the disposable copy again, and restores from the
same committed generation. The authoritative manifest remains unchanged.
Process termination can also leave an unreferenced sibling staging directory;
the host owns safe retention cleanup after excluding active recoveries.

The service does not lock the filesystem. A host must serialize preparation,
tool access, and checkpoint capture for one local root. Durable CAS prevents a
stale writer from silently replacing a newer manifest, but it does not make two
processes safe to share one mutable directory.

## Example

```ts
import {
  WorkingSetCheckpointService,
  deriveWorkingSetScopeId,
} from '@heddleagent/runtime/advanced';

const scopeId = deriveWorkingSetScopeId(verifiedIdentity);
const checkpoints = new WorkingSetCheckpointService('/runtime/session/working', store, {
  limits: {
    maxFileCount: 256,
    maxFileBytes: 2 * 1024 * 1024,
    maxTotalBytes: 32 * 1024 * 1024,
  },
  resetLocalWorkingCopy: () => runtimeSession.resetWorkingDirectory(),
});

await checkpoints.prepareOrRecover(scopeId);
// Construct and run filesystem tools only now.
await checkpoints.checkpoint(scopeId);
// Emit successful terminal settlement only now.
```

The numbers are illustrative. Heddle deliberately has no hidden working-set
size defaults; the host must select, monitor, and document its operational
bounds.
