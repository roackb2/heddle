# Chat Engine Sessions

This folder owns persisted chat-session behavior inside the conversation
engine.

If a rule about sessions should mean the same thing across TUI, ask mode, web,
or future hosts, it belongs here rather than in host-side code.

## Owns

- Persisted session state shape and lifecycle.
- Session preference semantics such as stored model and reasoning effort.
- New-session inheritance rules.
- Session-level default resolution at the engine boundary.
- File-backed session storage and migration behavior.

## Repository Direction

Storage mechanics should be isolated from domain rules.

Today, some hosts still call repository helpers directly. That is acceptable
only as a temporary shape while we refactor touched flows inward toward
services.

The target direction is:

- repository/storage modules own file I/O and serialization details;
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
- `repository/file-chat-session-repository.ts` owns file persistence.
- `archives/` owns file-backed archived transcript and rolling-summary
  persistence for compacted chat history.
- session title prompting lives under `records/` as session metadata behavior;
  first-message auto-rename policy lives on the session service so TUI and
  control-plane hosts share it.
- `types.ts` at this folder root describes the main session service contract
  and config shape.
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
- use `create`, `rename`, and `delete` for lifecycle changes;
- use `updateSettings` for shared model, reasoning-effort, and drift settings;
- reserve generic `update` for persisted session changes that are not yet
  expressed as a named service operation.

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
