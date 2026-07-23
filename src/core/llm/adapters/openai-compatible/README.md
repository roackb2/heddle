# OpenAI-Compatible Provider Profiles

This package owns Heddle's provider-family support for services that expose the
OpenAI-compatible `/chat/completions` and `/models` surface.

Profiles describe durable provider facts:

- the user-facing model prefix, such as `ollama/`, `lmstudio/`, or
  `openrouter/`;
- default endpoint and environment-variable names;
- whether the provider is local and whether an API key is required;
- model discovery labels and endpoint style;
- adapter capability claims.

The shared adapter owns only the common HTTP request/response translation. It
does not read environment variables, choose credentials, or decide which models
to show. Runtime credential services resolve concrete endpoint/auth facts, and
`src/core/llm/models/ModelOptionsService` aggregates discovered models for web
and TUI pickers.

Provider profiles may still use a specialized execution adapter when their wire
contract has semantics the shared codec must not flatten. Kimi Platform is one
such case: it uses the profile for endpoint and model discovery, but its adapter
privately preserves and replays `reasoning_content` across tool turns. Do not add
that provider-specific state to the shared compatible codec.

When adding another OpenAI-compatible service, add one profile here first, then
extend runtime credential tests and model-options discovery tests. Do not add
provider-specific endpoint parsing to web components, TUI picker services, or
server route handlers.
