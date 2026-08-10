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

`python-reference/` is a deliberately small clean-room implementation of the
same published v1 contract. It uses PyJWT, the official MCP Python SDK, HTTPX,
and the checked-in golden fixtures to prove that a non-TypeScript adopter can
issue authority, protect its MCP edge, and consume ordered Execution Host SSE
without importing Heddle or private host code.

It is a conformance reference rather than another supported SDK. See its
[README](python-reference/README.md) for setup and the explicit stop line.
