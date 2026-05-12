# Session Preferences

This domain owns the shared policy for persisted chat-session execution
preferences.

## Owns

- The persisted session preference shape that matters to hosts:
  - `model`
  - explicit `reasoningEffort`
- New-session preference inheritance rules.
- Session-switch adoption rules between stored session settings and active host
  state.
- Effective reasoning-effort resolution for display and request wiring.

## Does Not Own

- TUI rendering or React state management details.
- Control-plane transport or API schemas.
- LLM provider compatibility rules themselves. Those still belong to
  `src/core/llm/model-policy.ts`.

## Why This Exists

Heddle previously spread session model and reasoning behavior across TUI effects,
slash commands, session creation helpers, and model-policy defaults. That made
simple regressions hard to diagnose because there was no single place to answer:

- what a session stores;
- what a new session should inherit;
- what the active session should adopt on switch;
- what reasoning effort is effectively in force.

This module is the shared owner for that policy. Hosts should call into it
instead of re-deriving the rules locally.

## Agent-Facing Example

Given:

```json
{
  "storedSession": {
    "model": "gpt-5.4",
    "reasoningEffort": "low"
  },
  "activeHostState": {
    "model": "gpt-5.5",
    "reasoningEffort": "medium"
  }
}
```

On session switch, the host should adopt:

```json
{
  "model": "gpt-5.4",
  "reasoningEffort": "low",
  "effectiveReasoningEffort": "low"
}
```

For a brand-new session created from that active host state, the stored
preferences should start as:

```json
{
  "model": "gpt-5.5",
  "reasoningEffort": "medium"
}
```
