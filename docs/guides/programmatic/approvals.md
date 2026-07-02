# Approvals

Hosts own policy decisions. Heddle routes approval-gated tool calls to
`host.approvals.requestToolApproval`.

```ts
const result = await engine.turns.submit({
  sessionId,
  prompt,
  host: {
    approvals: {
      async requestToolApproval(request) {
        if (request.call.tool.startsWith('create_')) {
          return { approved: true, reason: 'Allowed by local host policy.' }
        }

        return { approved: false, reason: `Denied by host policy: ${request.call.tool}` }
      },
    },
  },
})
```

Keep policy close to the host because the host knows the product boundary,
workspace trust model, and user interaction requirements. Use capabilities and
custom-agent tool profiles when a host wants broader tool filtering before a
turn starts.
