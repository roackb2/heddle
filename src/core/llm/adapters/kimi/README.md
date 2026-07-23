# Kimi Platform Adapter

This package owns Heddle's Kimi Platform execution boundary. It translates the
provider-neutral LLM port into Kimi's OpenAI-compatible chat-completions wire
format while preserving the parts of Kimi's protocol that are not safely
handled by the shared compatible adapter.

## What This Adapter Owns

- Kimi Platform authentication through `MOONSHOT_API_KEY` or
  `KIMI_PLATFORM_API_KEY`;
- the default `https://api.moonshot.cn/v1` endpoint and `kimi/kimi-k3` model;
- K3 reasoning-effort validation (`low`, `high`, or `max`);
- streamed text, tool calls, usage, and completion validation;
- exact replay of Kimi's private `reasoning_content` between model-facing
  turns.

Kimi requires the complete assistant message, including `reasoning_content`,
to be replayed after a tool call. Heddle stores that value as an opaque
`providerContinuation` on the assistant transcript message. It is durable so a
resumed session can continue correctly, but it is provider-private state:

- do not expose it as a Heddle reasoning summary or assistant commentary;
- do not render it in clients;
- do not include it in logs or traces;
- do not rewrite it into a provider-neutral field.

Only the Kimi adapter may interpret the payload. Other providers ignore it.

## Deliberate Exclusions

This integration targets Kimi Platform API keys. Kimi Code membership keys and
its separate endpoint/quota lifecycle are not accepted. The generic
`KIMI_API_KEY` name is intentionally ignored because it does not identify which
product issued the credential.

The adapter does not claim support for provider-native web search, image input,
or image generation.

## Verification

Fixture-backed tests cover fragmented streaming, tool-call assembly, usage,
private continuation replay, invalid effort, and truncated streams. Before a
release claims production support, also run a real K3 tool-calling turn with a
Kimi Platform credential. This validates the live wire contract without
weakening deterministic CI.

Provider references:

- <https://platform.kimi.com/docs/guide/kimi-k3-quickstart>
- <https://platform.kimi.com/docs/guide/use-kimi-k2-thinking-model>
- <https://platform.kimi.com/docs/api/chat>
