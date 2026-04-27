# Providers And Models

Heddle currently has working provider adapters for:

- OpenAI
- Anthropic

## Required Environment Variables

Set at least one provider API key before running chat, one-shot tasks, or most examples:

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

## Notes

- Provider selection is inferred from the model name prefix.
- Gemini model names are recognized by provider inference, but a Google adapter is not wired yet.
- You can pass another supported model name with `--model` if the relevant provider adapter can handle it.
- Hosted web search availability depends on the selected provider/model path.

## See Also

- [CLI reference](cli.md)
- [Chat and sessions](../guides/chat-and-sessions.md)
- [Programmatic use](../guides/programmatic-use.md)
