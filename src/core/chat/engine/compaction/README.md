# Conversation Compaction

This folder owns conversation compaction inside the chat engine.

If compaction behavior should mean the same thing for ask mode, TUI turns,
web/control-plane turns, or future hosts, it belongs here rather than in a host
adapter.

## Owns

- Deciding whether history needs compaction.
- Choosing the archived slice versus recent active history.
- Writing archived transcript files and rolling summaries.
- Building compacted summary messages for future turns.
- Building persisted compaction context stats.
- Estimating history and request-token pressure for compaction decisions.

## Structure

- `service.ts` is the main service boundary. Callers should enter through
  `ConversationCompactionService`.
- `types.ts` describes the public compaction contract.
- `split-policy.ts` owns history split policy.
- `token-estimator.ts` owns token-pressure estimates.
- `summary-message.ts` owns compacted summary-message shape.
- `summarizer/` owns LLM summarizer selection, prompt text, and summarizer
  context assembly.
- `transcript-renderer.ts` owns archive transcript rendering for summarization.
- `context-builder.ts` owns persisted compaction context stats.

Avoid adding loose exported functions for compaction-domain behavior. If the
behavior is part of compaction semantics, put it on `ConversationCompactionService`
or a focused static class in this folder. Use external helpers only for
low-level formatting or mechanical transforms that are not compaction policy.
