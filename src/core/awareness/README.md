# Awareness

The awareness domain owns fresh current-state perception for the active workspace.

## Owns

- Domain-agnostic awareness snapshot contracts.
- Provider orchestration by awareness domain.
- Awareness formatting helpers shared by tool adapters.
- Coding awareness providers and collectors under `domains/`.
- Freshness, sources, and limits for awareness snapshots.

## Does Not Own

- Runtime orchestration, chat/session state, or system-prompt assembly.
- Approval policy or UI.
- Memory retrieval or maintenance.
- Control-plane projections.
- Automatic context injection or background refresh.

## Notes For Coding Agents

- Keep core contracts domain-agnostic.
- Put coding-specific fields in the coding domain types.
- Awareness tools should call this service boundary instead of duplicating collectors.
- Coding-domain service details and the agent-facing dashboard payload live in `domains/coding/README.md`.
