# Headless Conversation Agent

This module owns Heddle's smallest structured in-process SDK adoption path.

## Ownership

- `ConversationAgentService` constructs one conversation engine, ensures one
  stable durable session without a read/create race, submits turns, captures
  structured activities, and returns Heddle's normal structured turn result.
- `close()` stops new service work, aborts active turns, and waits for their
  operation-scoped resources, including MCP transports, to settle. It is
  asynchronous and idempotent.
- The underlying `engine` remains public so an adopter can progressively use
  full session, turn, artifact, persistence, and host-extension APIs without a
  rewrite.

Shared model, workspace/state, reasoning, memory-maintenance, and credential
defaults come from `../runtime/`. This module consumes that policy; it does not
fork or re-resolve it.

## Boundary

This is an SDK application service over `src/core/chat/engine`, not part of the
engine domain itself. The service is headless and in-process. It does not own terminal rendering,
HTTP, authentication, tenant mapping, public result projection, canonical
product transactions, or durable in-flight execution. A per-turn host callback
overrides the service default when approval or event handling is request-scoped.

Returned activities and turn results are trusted host data, not a browser-safe
wire contract. They may contain tool input/output, trace paths, artifacts, or
other internal details. Remote hosts must project an explicit public result and
activity schema before serialization.

The default stable session is `session-1`. Hosted or multi-user code must supply
an identity derived from trusted server-side scope, and must construct the
engine with appropriately scoped repositories. Heddle never derives tenant
identity from an unverified browser field.

## Example

```ts
const agent = new ConversationAgentService({
  session: { id: 'account-42:project-7', name: 'Project assistant' },
})

try {
  const result = await agent.send({
    prompt: 'Summarize this project.',
  })

  console.log(result.summary, result.activities)
} finally {
  await agent.close()
}
```

One-shot processes should close the service in `finally`. Long-running hosts
should keep one service for its intended scope and await `close()` during
application shutdown. Once closing begins, the service rejects new sessions and
turns. Direct use of the public `engine` has its own lifecycle and is not
tracked by the headless service.
