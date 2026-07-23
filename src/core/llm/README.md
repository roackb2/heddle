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
- `adapters/openai-compatible/` owns the shared provider-profile family for
  `/chat/completions` services such as Ollama, LM Studio, LiteLLM, vLLM,
  Hugging Face, OpenRouter, Together, and Groq.
- `adapters/kimi/` owns Kimi Platform's specialized chat-completions behavior,
  including exact replay of provider-private reasoning continuation.
- `models/` owns the curated model catalog and model policy decisions used by
  hosts.

The OpenAI adapter accepts two account-sign-in lifecycles. Stored OAuth
credentials may refresh through Heddle's credential repository. A
request-scoped `oauth-access-token` is already resolved by the host/runtime;
the adapter attaches it to requests, rejects it when expired, and never refreshes
or persists it. Provider-backed tools must receive the same resolved credential
as the main model so one run cannot silently change principals.

Some providers require opaque continuation state to be carried between
model-facing turns. That state belongs on the assistant message's
`providerContinuation`; it is durable protocol data, not user-facing reasoning
or commentary. Adapters must never render, trace, or log it. Kimi uses this
boundary for the raw `reasoning_content` that its API requires callers to replay
after tool calls.

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
