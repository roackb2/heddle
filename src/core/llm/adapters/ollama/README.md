# Ollama Adapter Boundary

This package keeps Heddle's public Ollama integration names and Ollama-native
model discovery facade. Shared `/chat/completions` transport now lives in
`src/core/llm/adapters/openai-compatible`.

- `OllamaProviderAdapter` registers the provider and enforces explicit model
  selection through `ollama/<model>` or `OLLAMA_MODEL`, while delegating shared
  transport to the OpenAI-compatible adapter.
- `OllamaAdapter` remains as the public Ollama adapter export for compatibility.
- `OllamaModelDiscoveryService` discovers installed local models through
  Ollama's native `/api/tags` endpoint for shared model pickers.

Do not shell out to `ollama list` from UI, server, or TUI code. The control
plane may run in daemon/web contexts where a CLI path is unreliable. Keep model
discovery endpoint-based here, then expose picker-ready options through
`src/core/llm/models/ModelOptionsService`.
