# Knowledge Persistence

Heddle can maintain durable workspace knowledge under `.heddle/memory/`.

The goal is to help the agent learn from real project work over time instead of rediscovering the same stable facts every session.

## What Belongs In Memory

Good memory content is stable, reusable project knowledge such as:

- architecture notes that future sessions should reuse
- recurring build, test, or environment quirks
- important repository conventions and command patterns
- durable findings from completed implementation work
- notes that save future operators from repeating the same discovery process

## What Does Not Belong In Memory

Memory should not be treated as scratch space. Avoid storing:

- speculative guesses
- temporary plans for the current turn
- transient debugging notes that will be stale soon
- raw chat transcripts

## Memory Model

The memory model is intentionally simple:

- memory is stored as readable markdown files in the project state directory
- Heddle can list, read, search, and edit those notes
- shell tools remain available when more flexible retrieval or editing is needed
- memory is workspace-local rather than a hosted central knowledge service

This is one of Heddle's more distinctive runtime capabilities: the aim is not just to answer the current prompt, but to let the runtime accumulate project understanding from real operator work and become more useful across sessions.

## Operational Notes

- Memory lives under `.heddle/memory/` by default.
- Notes are ordinary markdown files, so humans can review and edit them directly.
- Stable architectural or workflow findings are the best candidates for memory updates.

## See Also

- [Chat and sessions](chat-and-sessions.md)
- [Capabilities and tools](../reference/capabilities.md)
- [Project config](../reference/config.md)
