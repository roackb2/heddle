# Auth

`src/core/auth/` owns persisted provider credentials and OpenAI account sign-in.

The boundary is intentionally small:

- `ProviderCredentialRepository` owns `auth.json` path resolution, zod-backed
  deserialization, writes, private file permissions, summaries, and redaction.
- `OpenAiOAuthService` owns the OpenAI OAuth browser flow, token exchange,
  refresh, account-id extraction, and platform-specific browser launching.
- Runtime and LLM services may ask auth for credentials, but auth should not
  own model policy, adapter selection, tool behavior, or UI formatting.

When adding another persisted auth format, add schema fields in `schemas.ts` and
repository methods on `ProviderCredentialRepository`. Avoid loose one-off
exported functions; auth behavior should be reachable through a clear class
boundary.
