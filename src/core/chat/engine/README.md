# Conversation Engine Alpha

This folder is the owning bounded module for Heddle's persisted programmatic
conversation engine.

If a chat behavior has one true meaning across TUI, ask mode, daemon, or future
hosts, this engine or one of its explicit subdomains should own it. Hosts must
not each invent their own version.

## Owns

- Normalized engine config and derived paths in `config.ts`.
- Request-scoped runtime credential propagation across the main turn,
  compaction, and provider-backed tools. Token acquisition, refresh, and host
  transport remain outside the engine.
- File-backed session persistence, migration, lease rules, titles, archives, and
  conversation-line projection plus session execution-preference policy under
  `sessions/`.
- Persisted turn execution, runtime resolution, preflight compaction, memory
  maintenance, trace persistence, final durable persistence, and host adaptation
  under `turns/`.
- User-facing live conversation activity under `live/`. This is the shared
  event contract for TUI, browser control plane, and programmatic hosts.
- The alpha programmatic API through `conversation-engine.ts` and `index.ts`.
- Host-extension composition for SDK integrations, including curated MCP tool
  surfaces and artifact behavior.
- Host-facing turn result summaries, including trace file, completed tool
  results, session artifacts, and safe model-failure categories.

## Domain Ownership Rule

The engine should be the place where chat semantics become dead simple to
reason about.

That means:

- explicit persisted state stays small and obvious;
- defaults/fallbacks are resolved at one owning boundary;
- derived runtime state is derived once;
- hosts consume concrete values instead of re-deciding policy;
- duplicated host-side policy should be treated as a design bug to remove.

If multiple hosts need the same answer to a question like "what does this
session store?" or "what reasoning effort is actually in force?", the engine
should expose one answer rather than letting each host improvise.

## Service Structure Pattern

The current `sessions/`, `turns/`, and `compaction/` domains are the reference
shape for new engine services and major refactors.

Use this pattern when it fits the domain:

- `README.md` explains the boundary, owned behavior, and where adjacent logic
  should live.
- `types.ts` describes the public contract before readers need to inspect
  implementation detail.
- `service.ts` contains the main service class and grouped stateful behavior.
- Repositories are classes that own persistence mechanics and serialization
  boundaries.
- Zod schemas or equivalent mature validators own persisted disk shapes instead
  of ad hoc type guards.
- Subdomains use classes for grouped behavior. Use static methods for pure
  domain behavior that does not need an instance.
- Add a brief top-of-file or class comment for meaningful classes explaining
  what the class owns and how to decide whether new behavior belongs there.
- Avoid loose one-off exported functions for domain behavior. Put behavior on
  the owning service, repository, schema/codec, or focused subdomain class.
- Use `@/...` imports for cross-domain references; reserve relative imports for
  same-folder files and local subdomain indexes.

## Does Not Own

- TUI rendering, React, Ink, server DTOs, or control-plane transport.
- Low-level model/tool step execution internals outside the runtime/agent
  domains.

## Public Entry Points

- `createConversationEngine`
- `EngineConversationTurnService`
- `defineHostExtension`
- `defineMcpHostExtension`
- engine-facing types in `types.ts`

## Common Changes

- Put normalized config, path defaults, and engine-wide defaults in `config.ts`.
- Accept a transient provider access token through `credential`; never put it
  into session metadata, archives, traces, or the provider credential store.
- Put persisted session lifecycle behavior in `sessions/service.ts` and related
  `sessions/*` modules.
- Runtime and compaction events should already use the shared
  `ConversationActivity` shape from `src/core/live/`. Keep trace-to-activity
  adaptation at the `turns/host/` boundary because trace is evidence, not the
  primary user-facing event contract.
- Put submit/continue behavior in `turns/service.ts`.
- Put persisted turn phases in the explicit `turns/*/` subdomains.
- Put shared compaction behavior in `compaction/`.
- Put public turn result vocabulary in `turn-result.ts` so SDK hosts do not
  parse trace or artifact storage for common summaries.
- Read `result.failure` for product error handling. Provider error
  classification belongs to `src/core/agent/model/`; hosts must not parse
  `result.summary` or duplicate provider status maps.
- Put host-extension policy in `host-extension.ts` or focused helpers such as
  `mcp-host-extension.ts`; runtime toolkits should receive resolved policy,
  not re-read host-extension config.

## Notes For Coding Agents

- Do not rebuild flat `src/core/chat/*` wrappers around engine internals.
- The engine must own real behavior, not facade-only forwarding.
- When policy is scattered across App/hooks/storage/defaults, pull it toward an
  engine-owned service instead of adding another host-level reconciliation step.
- If a host only provides `events.onActivity`, it must still receive compaction
  activity through engine host normalization.
- Keep live activity vocabulary aligned with upstream event vocabulary. If a
  layer is only passing fields through, pass the source event instead of
  reassigning each field into another shape.
- Keep docs and exports clearly marked alpha.

See [docs/architecture/chat-layering.md](../../../../docs/architecture/chat-layering.md)
for the target folder structure and layering rules.
