# Node coordinator integration

This subpath provides the standard Node HTTP edge for product-issued heartbeat
delegations. It owns bounded JSON parsing, timing-safe bearer authentication,
authorization-header removal, safe failures, disconnect cancellation, and
graceful shutdown.

It does not own product routing, task authorization, signing keys, tenant
lookup, MCP policy, or coordinator credentials. Mount it before the product's
fallback router:

```ts
import {
  NodeHostedHeartbeatDelegationHttpService,
  takeHostedHeartbeatServiceToken,
} from '@heddleagent/execution-host-client/coordinator/node'

const apiToken = takeHostedHeartbeatServiceToken(
  process.env,
  'HEDDLE_COORDINATOR_DELEGATION_TOKEN',
)
if (!apiToken) throw new Error('Coordinator delegation token is required.')

const delegationApi = new NodeHostedHeartbeatDelegationHttpService({
  delegations,
  apiToken,
})

if (delegationApi.handle(request, response)) return

// During graceful shutdown:
await delegationApi.close()
```

`takeHostedHeartbeatServiceToken` validates the secret and removes it from the
mutable environment object so later application code cannot accidentally
enumerate it. Production secret delivery and rotation remain deployment-owned.
