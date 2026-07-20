# Runtime Credentials

Runtime credentials own provider credential source selection for generic agent
execution.

`RuntimeCredentialService` decides whether a model will use an explicit API key,
an environment API key, a stored OAuth credential, a request-scoped OAuth access
token, a local no-auth endpoint, or no available credential. Callers should
resolve this once at their owning runtime boundary and pass the concrete result
downward.

## Credential lifecycles

- Stored credentials may contain refresh material and are owned by
  `ProviderCredentialRepository`. The OpenAI adapter may refresh and persist
  them.
- A `RuntimeProviderCredential` is supplied by the embedding host for one
  engine/runtime instance. It contains only an access token and expiry. Heddle
  uses it for the main turn, compaction, and provider-backed tools, but never
  refreshes or writes it to the credential repository.

Hosts must acquire request-scoped tokens outside Heddle and send them only over
an authenticated transport. They remain responsible for tenant authorization,
redaction, and re-authentication after expiry or process/browser refresh.

Do not combine `apiKey` and `credential` for one runtime. The ambiguity is
rejected during resolution instead of relying on an implicit precedence rule.

Local providers are not "missing credentials." For example, Ollama resolves to a
`local-endpoint` source with the OpenAI-compatible base URL. Adapter creation
still happens in `src/core/llm`; this domain only owns the runtime credential
source used to decide whether execution is allowed.
