# Hosted conversation orchestration

This domain owns the reusable adopter-side middle of one conversation turn
against a separate Execution Host. Product code chooses authorized identity and
policy; Heddle owns the correctness-sensitive authority, invocation, stream,
and optional durable lifecycle mechanics that should not be rebuilt in every
adopter.

## Services

`HostedConversationTurnService` owns:

- validating normalized hosted-turn input;
- issuing short-lived execution and optional MCP authority;
- resolving model credentials through a narrow secret-provider port; and
- invoking one provider-neutral `ExecutionHost` stream.

`DurableHostedConversationTurnService` wraps any
`HostedConversationTurnRunner` and owns:

- writing `requested` before authority, credential, network, or model work;
- writing `running` before releasing the `accepted` event;
- projecting a closed, credential-free terminal status and writing it before
  releasing the terminal event;
- applying the same Unicode-code-point summary bound to persisted and live
  output;
- distinguishing explicit terminal cancellation from abort, disconnect,
  shutdown, transport interruption, protocol failure, and ambiguous EOF;
- failing closed when an accepted or terminal persistence write fails; and
- reconciling expired open turns within one already-authorized scope.

The wrapper sends no activity, tool payload, raw error, credential, assertion,
capability, trace, or provider-selected error code to its store. An exact
terminal cancellation event is the only path to `cancelled`; request aborts and
consumer disconnects remain `interrupted` because they do not prove user
intent. It never retries an ambiguous invocation.

## Persistence port

`HostedConversationTurnLifecycleStore` is deliberately database-neutral and
uses the already-authorized tenant, subject, and product-session scope. A store
implementation must:

- make invocation creation unique;
- fence every mutation by invocation and full scope;
- permit an exact repeated transition, including its timestamp, idempotently;
- reject conflicting or late transitions; and
- update only open, expired turns during reconciliation.

Use `HostedConversationTurnStoreConformance` from
`@roackb2/heddle-adopter/testing` to certify those requirements against the
real adapter. Heddle does not open a database connection, own a product schema,
or run migrations.

```ts
import {
  DurableHostedConversationTurnService,
  HostedConversationTurnService,
} from '@roackb2/heddle-adopter/conversation'

const executionTurns = new HostedConversationTurnService({
  authority,
  executionHost,
  modelCredentials,
  mcp: { allowedTools: ['read_workspace_snapshot'] },
})

const turns = new DurableHostedConversationTurnService({
  turns: executionTurns,
  store: productPostgresTurnStore,
})

// Product admission supplies only authenticated and authorized values.
for await (const event of turns.streamTurn({
  scope,
  runtimeSessionId,
  invocationId,
  prompt,
  deadlineAt,
  signal,
})) {
  yield event
}
```

## Adopter ownership

The adopter still owns:

- end-user authentication and product authorization;
- tenant, subject, product-session, Runtime-session, and invocation-ID
  selection;
- product MCP tools and capability policy;
- the PostgreSQL or other storage adapter, schema, migrations, availability,
  retention, encryption, and backups;
- product history queries, result application, billing, and UI; and
- explicit result lookup or retry policy for ambiguous prior invocations.

Product ownership of a durable record does not require product code to own the
generic stream-to-record state machine.

Expiry reconciliation needs a product deadline. Supply `deadlineAt` for turns
that must converge after a process crash, then call
`interruptExpiredHostedConversationTurns(...)` from the product's existing
history read or scheduler even when live execution is temporarily disabled.
The helper scopes the request; the store performs the atomic update. Heddle
does not invent a deadline, open a scheduler, or retry an ambiguous invocation.
