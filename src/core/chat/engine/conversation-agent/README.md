# Headless Conversation Agent

This domain owns Heddle's smallest structured in-process adoption path.

## Ownership

- `ConversationAgentRuntimeService` resolves the model, workspace/state roots,
  reasoning effort, memory-maintenance default, and early credential evidence
  shared by SDK starters.
- `ConversationAgentService` constructs one conversation engine, ensures one
  stable durable session without a read/create race, submits turns, captures
  structured activities, and returns Heddle's normal structured turn result.
- The underlying `engine` remains public so an adopter can progressively use
  full session, turn, artifact, persistence, and host-extension APIs without a
  rewrite.

## Boundary

The service is headless and in-process. It does not own terminal rendering,
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

const result = await agent.send({
  prompt: 'Summarize this project.',
})

console.log(result.summary, result.activities)
```
