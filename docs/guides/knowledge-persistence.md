# Knowledge Persistence

Heddle can maintain durable workspace knowledge under `.heddle/memory/`.

The goal is to help the agent learn from real project work over time instead of rediscovering the same stable facts, preferences, and workflows every session.

This is now an automatic part of normal Heddle usage. The main agent can notice durable knowledge while it works, record a candidate memory, and let a dedicated maintainer path fold that candidate into cataloged markdown notes after the user-facing turn.

## What Belongs In Memory

Good memory content is stable, reusable project knowledge such as:

- architecture notes that future sessions should reuse
- recurring build, test, or environment quirks
- important repository conventions and command patterns
- user or team preferences such as ticket formats, review style, or workflow expectations
- durable findings from completed implementation work
- notes that save future operators from repeating the same discovery process

## What Does Not Belong In Memory

Memory should not be treated as scratch space. Avoid storing:

- speculative guesses
- temporary plans for the current turn
- transient debugging notes that will be stale soon
- raw chat transcripts

## Memory Model

The memory model is intentionally explicit:

- memory is stored as readable markdown files in the project state directory
- the root catalog is `.heddle/memory/README.md`
- each memory category has its own folder catalog, such as `preferences/README.md` or `operations/README.md`
- normal agents can read and search memory, then record durable candidates
- a maintainer path owns cataloged note updates so discovery remains coherent
- maintenance runs and candidates are logged under `.heddle/memory/_maintenance/`
- memory is workspace-local rather than a hosted central knowledge service

This is one of Heddle's more distinctive runtime capabilities: the aim is not just to answer the current prompt, but to let the runtime accumulate project understanding from real operator work and become more useful across sessions.

## How Heddle Learns

During a normal chat or ask turn, Heddle may decide that something is worth preserving. Examples include a canonical verification command, a stable project convention, or a user-stated preference.

The main agent does not directly rewrite arbitrary memory notes by default. Instead, it records a candidate. A bounded maintainer process then reads the memory catalogs, searches existing notes, updates or creates the best note, and keeps the folder catalog discoverable.

Interactive chat schedules that maintenance in the background so the visible answer is not blocked. One-shot `ask` mode waits for maintenance inline when feasible so the process can exit with memory settled.

The important product promise is not just "memory exists." Heddle should become more useful in the workspace over time, and the user should be able to see exactly what it learned.

## Example: Remember A Ticket Format

A useful first test is to teach Heddle a preference that changes later behavior:

```text
Whenever I ask you to create a ticket, use these sections: problem statement, proposed approach, considered alternatives, conclusion.
```

After maintenance runs, ask from a fresh session:

```text
Create a ticket for maintaining doc consistency after feature updates.
```

The expected behavior is that Heddle follows the memory discovery path, recovers the ticket-format preference, and writes the ticket with those sections. This is a better test than remembering a single command because it checks whether Heddle can preserve operating style, not just facts.

## Operational Notes

- Memory lives under `.heddle/memory/` by default.
- Notes are ordinary markdown files, so humans can review and edit them directly.
- Stable architectural or workflow findings are the best candidates for memory updates.
- Use `heddle memory status`, `heddle memory list`, `heddle memory read <path>`, and `heddle memory search <query>` to inspect memory without opening files manually.
- Use `heddle memory validate` to check catalog shape, orphan notes, oversized catalogs, and pending candidate backlog.
- This is catalog-backed local markdown with explicit discovery paths and audit logs, so users can inspect what Heddle learned and how future agents are expected to find it.

## See Also

- [Chat and sessions](chat-and-sessions.md)
- [Capabilities and tools](../reference/capabilities.md)
- [Project config](../reference/config.md)
