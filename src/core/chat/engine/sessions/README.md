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

In this folder today:

- `session-record.ts` owns in-memory session record helpers
- `repository/file-chat-session-repository.ts` owns file persistence
- `service.ts` owns session behavior and should be the main path that hosts call

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
