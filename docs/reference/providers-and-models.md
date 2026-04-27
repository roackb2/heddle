# Providers And Models

Heddle currently has working provider adapters for:

- OpenAI
- Anthropic

## Provider Access

Configure access to at least one provider before running chat, one-shot tasks, or most examples.

For OpenAI, Heddle supports two user-selected paths:

- OpenAI account sign-in:

```bash
heddle auth login openai
```

- Platform API key:

```bash
export OPENAI_API_KEY=your_key_here
```

OpenAI account sign-in is experimental and uses the user's own ChatGPT/Codex account. It is not official OpenAI support, and Heddle is not affiliated with, endorsed by, or sponsored by OpenAI. API-key auth remains the stable OpenAI path.

For Anthropic, use an API key:

```bash
export ANTHROPIC_API_KEY=your_key_here
```

Heddle does not support Anthropic consumer subscription OAuth. That path is intentionally deferred unless Anthropic documents or approves a third-party auth route.

## Environment Variables

Supported provider API-key environment variables:

- `OPENAI_API_KEY` for OpenAI models
- `ANTHROPIC_API_KEY` for Anthropic models

For local development inside this repository, fallback env vars are also accepted:

- `PERSONAL_OPENAI_API_KEY`
- `PERSONAL_ANTHROPIC_API_KEY`

## Default Models

Current defaults:

- OpenAI: `gpt-5.1-codex`
- Anthropic: `claude-sonnet-4-6`

## Built-In Model Shortlist

OpenAI models currently included in the built-in shortlist:

- `gpt-5.5`, `gpt-5.5-pro`
- `gpt-5.4`, `gpt-5.4-pro`, `gpt-5.4-mini`, `gpt-5.4-nano`
- `gpt-5`, `gpt-5-pro`, `gpt-5-mini`, `gpt-5-nano`
- `gpt-5.2`, `gpt-5.2-pro`, `gpt-5.1`
- `gpt-4.1`, `gpt-4.1-mini`, `gpt-4.1-nano`
- `o3-pro`, `o3`, `o3-mini`, `o4-mini`
- coding-oriented models: `gpt-5.1-codex`, `gpt-5.1-codex-max`, `gpt-5.1-codex-mini`

Anthropic models currently included in the built-in shortlist:

- `claude-opus-4-6`, `claude-sonnet-4-6`, `claude-haiku-4-5`
- `claude-opus-4-1`, `claude-opus-4-0`, `claude-sonnet-4-0`
- `claude-3-7-sonnet-latest`
- `claude-3-5-sonnet-latest`, `claude-3-5-haiku-latest`

## Choosing A Model

You can select a model with CLI flags or chat commands:

```bash
heddle --model gpt-5.4-mini
heddle chat --model claude-3-5-haiku-latest
```

In chat, you can also use:

- `/model`
- `/model list`
- `/model set <query>`
- `/model <name>`

## Auth Commands

Provider credential commands:

```bash
heddle auth status
heddle auth login openai
heddle auth logout openai
```

Inside terminal chat, the same auth surface is available as slash commands:

- `/auth`
- `/auth status`
- `/auth login openai`
- `/auth logout openai`

The chat footer shows the active credential source for the selected model, such as `auth=openai-oauth`, `auth=openai-key`, or `auth=missing-openai`.

## OpenAI Account Sign-In Model Support

OpenAI account sign-in is routed through the ChatGPT/Codex transport path and is limited to models Heddle has explicitly allowed for that path:

- `gpt-5.1-codex`
- `gpt-5.1-codex-max`
- `gpt-5.1-codex-mini`
- `gpt-5.5`
- `gpt-5.2`
- `gpt-5.2-codex`
- `gpt-5.3-codex`
- `gpt-5.3-codex-spark`
- `gpt-5.4`
- `gpt-5.4-mini`

Use `OPENAI_API_KEY` for other OpenAI Platform models or features that require Platform API-key mode.

## Notes

- Provider selection is inferred from the model name prefix.
- Gemini model names are recognized by provider inference, but a Google adapter is not wired yet.
- You can pass another supported model name with `--model` if the relevant provider adapter can handle it.
- Hosted web search and image viewing currently require Platform API-key mode for OpenAI.

## See Also

- [CLI reference](cli.md)
- [Chat and sessions](../guides/chat-and-sessions.md)
- [Programmatic use](../guides/programmatic-use.md)
