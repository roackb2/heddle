# Quickstart Conversation CLI Runner

This module owns the smallest useful interactive console experience for
programmatic SDK users. It exists so a developer can verify Heddle's
conversation engine in a few lines before building a product UI, control-plane
integration, or custom host.

This is not the Heddle product CLI/TUI. The word "quickstart" is intentional:
this service may grow only when the change makes the first working SDK
conversation easier, smaller, or more predictable.

## Boundary

`QuickstartConversationCliRunnerService` owns:

- creating a persisted conversation engine and session;
- consuming `../runtime/` for generic workspace/state/model/memory defaults
  and credential preflight;
- printing default model and credential status;
- resuming a caller-selected session;
- running a one-shot prompt when the caller does not want an interactive loop;
- running an explicit scripted list of prompts/commands for reproducible
  non-interactive multi-turn runs (smokes, evals);
- attaching `createConversationTextHost` for streaming/status/result output;
- decorating user prompts before submission;
- running a readline loop;
- handling generic local commands: `/session`, `/help`, `/exit`;
- dispatching caller-supplied local commands such as `/artifacts`;
- exposing turn lifecycle hooks for host telemetry and run-file capture.

It does not own:

- Heddle product CLI/TUI behavior;
- daemon or control-plane transport lifecycle;
- product-specific command behavior;
- product-specific environment variable names beyond accepting already-resolved
  overrides;
- rich terminal composition, panels, composer state, model pickers, session
  browsers, diff viewers, or approval screens;
- custom approval UX;
- product-specific auth instructions beyond an optional missing-credential hint;
- custom telemetry or trace persistence beyond the default engine behavior;
- rich terminal UI behavior from `src/cli-v2`.

## Relationship To TUI

Both this module and the TUI run from a terminal, but they are different hosts.

For a non-terminal starter, use `ConversationAgentService`. It owns stable
session ensure, structured activity capture, and turn result. Both SDK hosts
consume the shared runtime defaults from `../runtime/`. This module adds
readline, text rendering, commands, and CLI hooks; it must not become a parallel
implementation of the headless host.

```text
src/sdk/conversation/console/
  SDK starter host. Directly creates a conversation engine, uses readline,
  uses createConversationTextHost, and exposes a tiny customization surface.

src/cli-v2/
  Heddle product CLI/TUI. Owns command bootstrap, Ink UI composition,
  control-plane attach/embed lifecycle, rich session UX, and product workflow.
```

Use this module when the goal is:

- "I want the smallest possible interactive SDK example."
- "I need a temporary external integration harness."
- "I need one or two generic hooks around `createConversationEngine` without
  owning a full UI."

Use `src/cli-v2` or a product-specific host when the goal is:

- rich terminal UI, panels, or keyboard-driven interaction;
- Heddle product commands such as `heddle chat` or `heddle ask`;
- control-plane server transport, daemon lifecycle, or shared web/TUI behavior;
- complex session management, model switching UI, approval UI, or trace review;
- product-specific command vocabulary or workflow.

If a proposed change requires maintaining UI-local state, rendering a new
interactive view, coordinating control-plane transport, or adding product
workflow semantics, it does not belong in this module.

## Extension Rule

Only extend this runner for quickstart ergonomics. A good addition usually
removes common SDK boilerplate from a first integration, such as generic
credential preflight, default text output, minimal local commands, host
extension wiring, or a lifecycle hook.

Before adding behavior here, ask:

1. Would a first-time SDK user reasonably expect this in a tiny starter loop?
2. Is the behavior generic across products and not specific to Heddle's TUI?
3. Can it be explained without introducing UI state, panels, or transport
   lifecycle?
4. Does it reduce host boilerplate rather than becoming a second CLI product?

If any answer is "no", put the behavior in the product host, `src/cli-v2`, the
control-plane layer, or the underlying conversation engine service.

## Defaults

`resolveQuickstartConversationCliDefaults` is the public way to ask the runner for the
same concrete defaults it will use internally. Call it when host code needs a
resolved `stateRoot` or model before `runQuickstartConversationCli` starts, for
example when preparing host extensions.

The default model order is:

1. `options.model`
2. `HEDDLE_MODEL`
3. `HEDDLE_EXAMPLE_MODEL`
4. `OPENAI_MODEL`
5. `ANTHROPIC_MODEL`
6. Heddle's built-in OpenAI default

The runner defaults memory maintenance to `none`, leaves `maxSteps` unset, and
uses the core default `maxToolConcurrency` of `4`. Hosts that need background
maintenance, a hard turn budget, or a different bound for explicitly
parallel-safe tools should override those values once at this boundary. Set
`maxToolConcurrency` to `1` to disable overlapping tool execution.

When a host needs custom UI, routing, approvals, or domain commands, use
`createConversationEngine` directly and treat this runner as the migration
example. If a host only needs prompt decoration, approval policy, turn hooks, or
a few local commands, keep those concerns at this boundary and let the runner
own the generic console loop.

## Prompt Input Modes

The runner selects exactly one input mode, checked in this order:

1. `oncePrompt` — submit a single prompt as one turn, then return. Use for the
   simplest one-shot host.
2. `prompts` — submit an explicit ordered list of prompts and local commands as
   sequential turns, then return. This is the reproducible non-interactive
   multi-turn path for smokes and evals. Each entry is dispatched exactly like
   an interactive line (local commands such as `/session`, `/exit`, and
   caller-supplied commands are honored, and `/exit` stops the run early).
   Prefer this over piping newline-separated prompts into `input`: an
   interactive readline loop drops queued prompts once stdin closes while a turn
   is still running, so only the first prompt survives.
3. `input` (default) — run the interactive readline loop until `/exit` or EOF.
