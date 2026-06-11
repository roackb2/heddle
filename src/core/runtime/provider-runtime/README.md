# Provider Runtime

Provider runtime resolution composes the lower-level LLM adapter boundary with
runtime credential policy. It answers one question for host-facing execution:
"given this selected model, what concrete provider, credential source, API key,
and adapter runtime should be used?"

Keep provider transport facts here when they are runtime concerns, such as the
Ollama OpenAI-compatible endpoint. Do not move this logic into CLI/web/server
controllers, and do not make `src/core/llm` import runtime credential services.
`src/core/llm` defines adapter contracts and provider adapters; this domain
resolves the executable runtime facts and passes them downward.
