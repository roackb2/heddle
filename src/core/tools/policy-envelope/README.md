# Tool Policy Envelope

This domain owns the shared model-facing policy envelope that can be attached
to tool calls. Toolkits own their business input schemas; this domain owns the
common `policy` field so every environment-touching tool can expose the same
low-friction intent contract without duplicating schema fragments.

## Owns

- The shared `ToolPolicyEnvelope` type.
- The JSON-schema fragment for the `policy` field.
- Central schema augmentation for object-shaped tool parameters.
- Input extraction that separates the envelope from tool business input before
  execution.

## Does Not Own

- Approval policy decisions. Those belong to `src/core/approvals`.
- Tool-specific input interpretation. Those belong to the relevant toolkit.
- Trace persistence. Trace events consume the same domain objects but do not
  define this shape.

## Boundary Rule

Agents report intent through this envelope. The runtime may use it as a policy
claim, but it must not treat it as verified fact.
