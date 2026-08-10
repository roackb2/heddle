# Adopter examples

`node-control-plane.ts` is the lowest-code Node reference for an adopter
backend. It composes the public authority, hosted-conversation orchestration,
Node HTTP edge, and local Execution Host contract fixture without importing the
Heddle runtime or private host implementation.

Run it from the repository root:

```bash
yarn adopter:example:node-control-plane
```

The example uses an ephemeral signing key, a fake user, a placeholder model
credential, and the local contract fixture. It proves composition and the
adopter-facing wire only; it is not a production key, identity, model, Heddle,
or AgentCore integration.
