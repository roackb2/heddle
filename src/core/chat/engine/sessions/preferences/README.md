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
- On a model change, the session service clears an inherited explicit effort
  if the new model does not support it. An explicit effort supplied with the
  same update remains explicit and is validated at the provider boundary.

## Does Not Own

- TUI rendering or React state management details.
- Control-plane transport or API schemas.
- LLM provider compatibility rules themselves. Those still belong to
  `src/core/llm/models/model-policy-service.ts`.

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

## Refactoring Pattern

Treat this module as a golden example for policy cleanup in Heddle.

The rule is:

1. resolve once at the owning domain boundary;
2. persist the explicit state that actually matters;
3. derive effective runtime state in one owner;
4. pass concrete values downward;
5. do not re-resolve defaults or fallbacks in every host layer.

Good boundary points for resolution:

- loading stored session data;
- creating the first session when no session exists yet;
- creating a brand-new session from the currently active host state;
- deriving one effective runtime value from one explicit stored value plus one
  model policy default.

Bad patterns this module is meant to avoid:

- every layer doing `x ?? y ?? z` again;
- spread-based object copying plus another fallback at the next layer;
- hosts reinterpreting stored session state differently;
- separate UI, CLI, and engine paths all deciding their own defaults.

If future refactors touch another messy domain, mimic this shape:

- define one owner for the policy;
- keep explicit stored state small;
- keep derived state derived;
- leave fallback logic only at true system boundaries;
- pass plain resolved values downward after the owner has decided.

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

The important point is that lower layers should receive these already-resolved
preferences, not repeat the inheritance logic again.
