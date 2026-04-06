# Web Search And Image Viewing

This document captures the near-term product approach for two capability gaps that matter for coding-agent workflows:

- web search
- image viewing

The goal is to add both in a way that matches Heddle's current runtime shape instead of forcing a premature redesign of the agent loop.

## Product Goal

Heddle should be able to:

- search the public web when repo-local evidence is not enough
- inspect user-referenced local images when the user includes screenshots, diagrams, or other visual context

Both capabilities should stay operator-visible, traceable, and consistent with Heddle's minimal-runtime philosophy.

## MVP Decision

The first implementation should take the lowest-friction path for each capability.

### Web Search MVP

Use a normal host-side `web_search` tool.

The first backend should call OpenAI's hosted web search capability from inside the tool implementation rather than trying to turn provider-native tools into first-class runtime abstractions immediately.

Why this is the right first step:

- it fits Heddle's existing "tool call -> host executes tool -> tool result goes back into the transcript" loop
- it avoids redesigning the tool protocol before we have traces showing what a better abstraction needs
- it gives immediate user value with a small implementation surface
- it keeps search explicit and visible in the trace

Near-term constraints:

- initial implementation can be OpenAI-backed only
- the tool should fail clearly when an OpenAI API key is missing
- the tool should return a concise text summary plus citations/URLs when available

Later evolution:

- add Anthropic-backed hosted web search as another backend option
- eventually generalize tool metadata so Heddle can expose provider-hosted tools directly when that becomes worth the extra abstraction

### Image Viewing MVP

Use path references plus a host-side `view_image` tool.

The user should be able to reference a local image path in chat. The agent should decide whether it actually needs to inspect that image and only then call `view_image`.

Why this is the right first step:

- Heddle's transcript and adapter boundary are text-only today
- a path-plus-tool model fits the current host-executed tool architecture
- it avoids immediate multimodal transcript redesign across chat storage, session restore, and provider adapters
- it mirrors a practical operator workflow: mention a screenshot path, then inspect it only if needed

Near-term constraints:

- the path itself is not the image; it is only a reference
- the agent cannot "see" a local image unless it calls the image-viewing tool
- the first version should focus on local file paths rather than true multimodal attachments

Later evolution:

- add real attachment objects to session state and the prompt composer
- send image bytes or uploaded file IDs directly to providers as multimodal input
- preserve attachments across saved and resumed sessions

## Why Not Do The Bigger Design First

Heddle currently assumes tools are host-executed and message content is text-first. A direct provider-native tool model for web search and a real multimodal transcript model for images are both plausible longer-term directions, but both are broader architectural changes.

The current priority is usefulness with minimal runtime disruption:

- web search first, through a standard host tool
- image viewing second, through a standard host tool keyed by file path

If traces later show repeated friction from this approach, that is the right time to promote richer abstractions into the runtime.

## Proposed Execution Order

1. Add `web_search` as a host-side tool backed by OpenAI hosted web search.
2. Expose it in chat and ask mode.
3. Refine output shape, citation formatting, and failure messages based on traces.
4. Add `view_image` as a host-side local file image inspection tool.
5. Add prompt guidance so the agent knows when to inspect a user-provided screenshot path versus when to ignore it.
6. Reassess whether provider-native tools or true multimodal attachments are justified by real usage.

## Acceptance Bar

### Web Search

- the agent can choose `web_search` when repo-local evidence is insufficient
- search results are returned as explicit tool output, not hidden model behavior
- citations or URLs survive into the transcript/tool result
- failure mode is explicit when no OpenAI key is available

### Image Viewing

- the user can mention a local image path naturally in chat
- the agent can decide whether to inspect it
- image inspection is explicit in the trace through `view_image`
- no multimodal session redesign is required for the first version
