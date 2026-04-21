# Development And Contributing

This repository is already usable as an OSS coding-agent runtime, but it is still evolving. Contributions are welcome, especially around workflow polish, documentation, tests, and control-plane usability.

## Prerequisites

- Node.js 20 or newer
- Yarn
- An API key for at least one supported provider if you want to run live chat or examples

## Setup

Clone the repo and install dependencies:

```bash
git clone https://github.com/roackb2/heddle.git
cd heddle
yarn install
```

Build the project:

```bash
yarn build
```

Run tests:

```bash
yarn test
```

Run lint and type checking when you are making code changes:

```bash
yarn eslint
yarn typecheck
```

## Local Development Workflows

### CLI and chat

Run the CLI directly from source:

```bash
yarn cli:dev --help
yarn chat:dev
```

`yarn chat:dev` runs the same source CLI entry point as the packaged `heddle chat` command. The `examples/` directory is reserved for programmatic host/runtime examples rather than the main terminal chat UI.

If you prefer provider-specific local shortcuts, the repository also includes convenience scripts such as:

```bash
yarn chat:dev:openai
yarn chat:dev:anthropic
```

These rely on the personal fallback environment variables described in [Providers and models](../reference/providers-and-models.md).

### Control plane

For control-plane development, run the backend and frontend separately:

```bash
yarn daemon:dev
yarn client:dev
```

The daemon-backed backend runs on `127.0.0.1:8765` and the Vite client runs on `127.0.0.1:5173`.

`yarn daemon:dev` uses the real daemon path, including workspace ownership, daemon-registry heartbeats, and built control-plane static assets from `dist/src/web`. This is the closest development path to the shipped `heddle daemon` behavior.

Because it serves built assets, run `yarn build` after frontend changes before relying on `yarn daemon:dev` for UI validation.

`yarn server:dev` remains a lighter backend-only path for server work. It starts the Express/tRPC app directly and does not register daemon ownership, so the clients will read that path as a local control-plane session rather than a daemon-owned workspace.

For a production-style local run of the built daemon:

```bash
yarn build
node dist/src/cli/main.js daemon --host 127.0.0.1 --port 8765
```

### Examples

The repository includes example programs for common host/runtime patterns:

```bash
yarn example:repo-investigator
yarn example:programmatic
yarn example:heartbeat
yarn example:heartbeat-scheduler
yarn example:host-events
yarn example:cyberloop-observer
```

These are useful both as smoke tests and as reference code for embedding Heddle in another host.

## Project Layout

High-level areas:

- `src/cli/`: CLI entrypoints and interactive chat flows
- `src/server/`: daemon server and control-plane backend
- `src/web/`: control-plane frontend
- `src/__tests__/`: automated tests
- `examples/`: programmatic and workflow examples
- `docs/`: user, operator, and project documentation

## State And Generated Artifacts

During local use, Heddle writes runtime state under `.heddle/`, including sessions, traces, approvals, logs, and memory notes.

## Web UI Styling

The existing desktop control plane still uses the legacy stylesheet in `src/web/features/control-plane/control-plane.css`.

New mobile-first control-plane surfaces should use Tailwind CSS and shadcn-style source components under `src/web/components/ui/`. The project is wired for Tailwind v4 through `@tailwindcss/vite`, with shared utility merging in `src/web/lib/utils.ts`.

Keep the styling boundary explicit:

- use Tailwind/shadcn for new mobile components
- leave existing desktop components on the legacy CSS until they are intentionally migrated
- share data hooks, API types, and formatting helpers across both surfaces

Build output goes to `dist/`.

These directories are runtime artifacts, not the main source of truth for understanding the codebase.

## Contribution Guidelines

Reasonable contribution targets right now include:

- documentation clarity and missing examples
- test coverage for runtime and CLI behavior
- control-plane usability improvements
- shell/tooling safety and review UX
- heartbeat workflow improvements
- bug fixes in provider adapters, persistence, or session flows

When contributing:

- keep changes bounded and explain the operator-facing effect
- prefer updating docs alongside behavior changes
- add or adjust tests when the change affects stable behavior
- verify the relevant workflow, not just the edited file

## Before Opening A PR

A good baseline checklist is:

```bash
yarn build
yarn test
yarn eslint
yarn typecheck
```

If your change affects the browser UI, also test the control plane manually.

## Release Notes

For user-facing releases, follow the release convention in [`docs/releases/README.md`](../releases/README.md).

In short:

- verify the intended release commit is green
- review the real git range since the previous release tag
- optionally use `yarn release:context <previous-tag> HEAD` to gather raw release scope
- write curated release notes from the actual scope
- create an annotated tag such as `vX.Y.Z` on the shipped commit

## Related Docs

- [Chat and sessions](chat-and-sessions.md)
- [Control plane](control-plane.md)
- [Programmatic use](programmatic-use.md)
- [CLI reference](../reference/cli.md)
- [Framework Vision](../framework-vision.md)
