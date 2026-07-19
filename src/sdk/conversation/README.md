# SDK Conversation Hosts

This area owns adopter-facing application services that compose Heddle's
conversation engine into small working host experiences. It exists so a new
SDK user can start with one useful conversation and progressively take control
of the engine without rebuilding their integration.

It is deliberately outside `src/core/chat/engine`: the engine owns persisted
conversation meaning, session and turn lifecycle, compaction, and persistence
contracts. SDK hosts select and orchestrate those capabilities for a particular
adoption experience; they must not redefine the underlying semantics.

## Modules

- `runtime/` resolves the model, workspace/state roots, reasoning effort,
  memory-maintenance default, and credential preflight shared by SDK hosts.
- `headless/` owns `ConversationAgentService`, the smallest structured,
  in-process product embedding.
- `console/` owns `runQuickstartConversationCli`, a temporary interactive
  console for evaluation, examples, smoke runs, and very small terminal hosts.

The headless and console services overlap in setup because both are SDK entry
points over the same engine. They intentionally differ in host contract:
headless returns structured results to caller-owned input/output, while console
owns readline, text rendering, and local commands. Their shared runtime module
prevents defaults and credential policy from drifting.

## Product Boundary

These services are not Heddle product applications. `src/cli-v2` owns the
`heddle` terminal product, rich TUI workflows, and command bootstrap;
`src/server` and `src/web-v2` own the control plane. Product-specific UI,
transport, tenant authorization, and workflow policy stay in those products or
in the adopter's host.

Keep the public root-package names stable. Internal source placement expresses
ownership; it should not force adopters to learn Heddle's repository layout.
