# LLM Boundary

`src/core/llm` owns Heddle's provider-neutral LLM port and the provider
adapters behind it. Runtime, agent, chat, tools, and server surfaces should ask
`LlmAdapterService` for an adapter instead of importing provider SDK classes or
choosing providers themselves.

## Shape

- `types.ts` defines the stable port contracts: messages, responses, usage,
  credentials, runtime context, and adapter creation input.
- `service.ts` is the application-facing entry point. It delegates provider
  resolution to the built-in registry.
- `registry/` owns provider inference and provider-adapter lookup.
- `adapters/<provider>/` owns SDK-specific payload conversion, streaming, and
  credential wiring for one provider.
- `models/` owns the curated model catalog and model policy decisions used by
  hosts.

Provider adapters should follow the local pattern:

- expose a class for the provider adapter and concrete LLM adapter;
- put provider-specific payload transforms in a small codec class;
- use grouped `credentials` and `runtime` input instead of repeatedly unpacking
  and reassigning the same fields;
- add a new provider by registering a provider adapter in
  `BuiltinLlmProviderRegistry`, not by adding provider conditionals at call
  sites.

Callers may still choose product semantics such as the active model, but model
ownership, provider inference, adapter construction, and credential
compatibility live here.
