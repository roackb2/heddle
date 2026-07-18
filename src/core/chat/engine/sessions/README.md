# Chat Engine Sessions

This folder owns persisted chat-session behavior inside the conversation
engine.

If a rule about sessions should mean the same thing across TUI, ask mode, web,
or future hosts, it belongs here rather than in host-side code.

## Owns

- Persisted session state shape and lifecycle.
- Session preference semantics such as stored model and reasoning effort.
- The persisted FIFO prompt queue used when a user submits follow-up work while
  a session already has earlier work to finish.
- New-session inheritance rules.
- Session-level default resolution at the engine boundary.
- Race-safe create-or-read for a host-provided stable session identity.
- Storage-independent session mutation coordination and bounded optimistic
  update retries.

## Repository Direction

Storage mechanics should be isolated from domain rules.

Today, some hosts still call repository helpers directly. That is acceptable
only as a temporary shape while we refactor touched flows inward toward
services.

The target direction is:

- repository/storage modules own async record I/O, serialization, pagination,
  and atomic compare-and-swap details;
- session services own session behavior and policy;
- hosts consume session services instead of touching storage mechanics.

The intended structure is class-based by responsibility:

- `service.ts` owns the stateful session boundary and should be the main path
  that hosts call.
- `records/` owns pure in-memory session record behavior, such as record
  creation, touch semantics, summaries, generic-name checks, and conversation
  line projection. These are static domain methods because they need no
  service instance.
- `leases/` owns pure lease policy. Lease acquisition, release, freshness, and
  conflict semantics live together as static domain methods.
- `repository/types.ts` defines the async port used by local and hosted
  adapters; `repository/file-chat-session-repository.ts` owns the default JSON
  persistence implementation.
- `archives/` owns file-backed archived transcript and rolling-summary
  persistence for compacted chat history.
- session title prompting lives under `records/` as session metadata behavior;
  first-message auto-rename policy lives on the session service so TUI and
  control-plane hosts share it.
- queued prompt operations live on the session service. Hosts and control-plane
  routes may enqueue, edit, delete, and dequeue through named service methods,
  but must not keep a separate host-local queue as the source of truth.
- the shared service contract lives in `../types.ts`; this folder's `types.ts`
  owns the service composition/config shape.
- each meaningful subfolder exposes a `types.ts` contract so callers can see
  the boundary shape without reading implementation details first.

Avoid adding loose exported helper functions for session-domain behavior. If the
behavior is part of session semantics and needs state or dependencies, put it on
the session service or another instantiated collaborator. If it is pure session
domain logic, put it on a static domain class under the relevant subfolder. Use
`utils/` only for low-level formatting or mechanical transforms that are not
session policy.

The service API should cover ordinary host needs directly:

- use `list`, `read`, `require`, and `latest` for session lookup;
- use `create`, `ensure`, `rename`, and `delete` for lifecycle changes;
- use `updateSettings` for shared model, reasoning-effort, and drift settings;
- reserve generic `update` for persisted session changes that are not yet
  expressed as a named service operation. Its updater may be reapplied after a
  revision conflict and must not perform external side effects.

That rule applies even for local hosts like the TUI. The TUI may call core
session services directly, but it should not call repositories or file-storage
helpers directly. Treat the local TUI the same way you would treat a web client
calling a backend API: the host talks to the service, and the service talks to
storage.

Do not introduce a ceremonial repository layer for everything. Extract it when
it materially simplifies a real flow being changed.

## Session Rule

Session semantics should be dead simple:

- stored explicit state stays small;
- defaults are resolved once at the owning boundary;
- derived effective state is derived once;
- hosts consume concrete values instead of re-resolving policy.

## Queued Prompt Invariants

Queued prompts are persisted session facts, not UI state. A prompt accepted
while earlier work is active is appended to `queuedPrompts`, streamed to all
subscribed interfaces through the control plane, and later dequeued in FIFO
order before it becomes the accepted user message for its own run.

Interfaces may choose how to render queued prompts, including edit and delete
controls, but the queue order and persistence policy belong here. Do not add a
parallel browser-only or terminal-only queue; that would break cross-device
sync and make one interface disagree with another.
