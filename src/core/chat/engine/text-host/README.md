# Conversation Text Host

This module owns the reusable text rendering path for programmatic conversation
hosts. It turns semantic conversation activity, trace events, compaction status,
and final turn results into stable plain-text output.

Use it when a host wants a working console-like experience without reimplementing
assistant streaming deltas, status lines, trace labels, or result summaries.
Product hosts can pass their own writer to route the same formatted text to a
terminal, file, log collector, or UI bridge.

Keep product-specific labels outside this module. This layer should only render
generic Heddle conversation concepts.
