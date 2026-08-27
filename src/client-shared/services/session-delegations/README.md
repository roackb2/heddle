# Session delegation projection

This client-shared service owns the frontend-neutral projection of subagent
lifecycle events and settled per-turn delegation records.

## Boundary

- Core and the control plane own delegation policy, event ordering, correlation
  identifiers, cancellation, and durable records.
- This service owns replay-safe live rows, compact settled rows, safe child
  activity labels, and duration/text formatting shared by web-v2 and cli-v2.
- Web-v2 and cli-v2 own layout, colors, accessibility, keyboard interaction,
  and their local default-on composer preference.

The projection deliberately excludes raw child transcripts, traces, model and
provider details, tool inputs, and permission controls. Extending those facts
requires a separate durability and disclosure design.
