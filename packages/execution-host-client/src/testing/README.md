# Adopter test and conformance support

## Durable lifecycle store conformance

`HostedConversationTurnStoreConformance.verify(...)` certifies the atomic
storage behavior required by `DurableHostedConversationTurnService`: unique
creation, full-scope fencing, idempotent exact repeats, conflicting and late
transition rejection, and scoped expiry reconciliation. Supply the real store,
a scoped inspection callback, and cleanup for the test's reserved conformance
records. The helper is database-neutral and does not create schemas or run
migrations.

## Local Execution Host contract fixture

This test-only Node.js boundary lets an adopter exercise its integration
through the real v1 HTTP/SSE contract without running a model, Heddle, Docker,
or AWS. Import it explicitly from `@heddleagent/execution-host-client/testing`; it is not
re-exported from the package root.

The fixture owns:

- a loopback-only HTTP server and a hidden, randomly generated local token;
- strict request/header validation and sensitive-header redaction;
- ordered `accepted`, `activity`, and terminal SSE events;
- request, connection, and fixture-shutdown cancellation;
- a callback that can call the adopter's real local MCP server or product API;
- explicit interrupted EOF for recovery-path tests.

The fixture does **not** run Heddle or prove model behavior, shell/filesystem
capability, JWT verification inside the real Execution Host, container or
microVM tenant isolation, AgentCore routing, or managed-runtime recovery.
Those require the real host at the corresponding evidence boundary.

## Code ownership

- `types.ts` is the only public fixture contract.
- `local-execution-host-contract-fixture.ts` owns server and invocation
  lifecycle orchestration.
- `request.ts` owns HTTP validation, body bounds, local authentication, and
  early sensitive-header redaction.
- `invocation.ts` owns non-enumerable request credential access.
- `event-stream.ts` owns ordered SSE envelopes, validation, and backpressure.

Keep adopter product policy, MCP tool implementations, and real-host behavior
out of this directory. Add another fixture only when it proves a distinct
public contract rather than one product's scenario.

```ts
import {
  LocalExecutionHostContractFixture,
} from '@heddleagent/execution-host-client/testing'

const fixture = await LocalExecutionHostContractFixture.start({
  execute: async (invocation) => {
    // This callback may invoke the adopter's real MCP endpoint with the opaque
    // capability. Identity must still be verified independently by that MCP.
    await callProductMcp(invocation.mcpCapability(), invocation.signal)
    await invocation.publishActivity({ type: 'product_state_read' })
    return {
      kind: 'result',
      result: { outcome: 'done', summary: 'Local contract path completed.' },
    }
  },
})

try {
  const host = fixture.createExecutionHost()
  for await (const event of host.streamConversationTurn(input)) {
    observe(event)
  }
} finally {
  await fixture.close()
}
```

The model key and execution assertion are validated and discarded before the
callback. The product MCP capability is available only through an explicit
accessor. `JSON.stringify(invocation)` returns data-minimized,
credential-free metadata and never includes the prompt or capability. Those
identifiers can still be product data and remain subject to normal logging
policy.
