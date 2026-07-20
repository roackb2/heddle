# Auth

`src/core/auth/` owns persisted provider credentials and OpenAI account sign-in.

The boundary is intentionally small:

- `ProviderCredentialRepository` owns `auth.json` path resolution, zod-backed
  deserialization, writes, private file permissions, summaries, and redaction.
- `OpenAiOAuthService` owns the OpenAI OAuth browser flow, token exchange,
  refresh, account-id extraction, and platform-specific browser launching.
- `OpenAiDeviceCodeAuthService` owns the stateless hosted/device-code handshake.
  It validates the provider payload, reports pending/expired states, exchanges
  an approved code, and returns only a `RuntimeProviderCredential`. It must not
  expose or persist the refresh token from the exchange.
- `ProviderCredentialCommandService` owns shared credential command semantics
  such as status, OAuth login, and logout. Terminal and control-plane hosts may
  call it, but they still own their own rendering and invocation flow.
- Runtime and LLM services may ask auth for credentials, but auth should not
  own model policy, adapter selection, tool behavior, or UI formatting.

Device-code login is an experimental OpenAI Codex binding, not a generic OAuth
server. A host owns its authenticated routes, rate limits, anti-phishing UX,
and the browser's in-memory credential lifetime. Respect the challenge's
`intervalMs`; do not create a server-side polling loop or persist the challenge.

When adding another persisted auth format, add schema fields in `schemas.ts` and
repository methods on `ProviderCredentialRepository`. Avoid loose one-off
exported functions; auth behavior should be reachable through a clear class
boundary.
