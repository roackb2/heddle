# Ollama Adapter Boundary

This package owns Heddle's Ollama provider integration.

- `OllamaProviderAdapter` registers the provider and enforces explicit model
  selection through `ollama/<model>` or `OLLAMA_MODEL`.
- `OllamaAdapter` translates Heddle chat requests to Ollama's
  OpenAI-compatible `/v1/chat/completions` endpoint.
- `OllamaModelDiscoveryService` discovers installed local models through
  Ollama's native `/api/tags` endpoint for shared model pickers.

Do not shell out to `ollama list` from UI, server, or TUI code. The control
plane may run in daemon/web contexts where a CLI path is unreliable. Keep model
discovery endpoint-based here, then expose picker-ready options through
`src/core/llm/models/ModelOptionsService`.
