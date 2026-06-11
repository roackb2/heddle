# Runtime Credentials

Runtime credentials own provider credential source selection for generic agent
execution.

`RuntimeCredentialService` decides whether a model will use an explicit API key,
an environment API key, a stored OAuth credential, a local no-auth endpoint, or
no available credential. Callers should resolve this once at their owning
runtime boundary and pass the concrete result downward.

Local providers are not "missing credentials." For example, Ollama resolves to a
`local-endpoint` source with the OpenAI-compatible base URL. Adapter creation
still happens in `src/core/llm`; this domain only owns the runtime credential
source used to decide whether execution is allowed.
