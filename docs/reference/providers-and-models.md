# Providers And Models

For the quick support matrix, start with [Model providers](model-providers.md).

Heddle currently has working provider adapters for:

- OpenAI
- Anthropic
- Ollama
- LM Studio
- LiteLLM
- vLLM
- Hugging Face
- OpenRouter
- Together AI
- Groq

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

For Ollama, install and start Ollama locally, then select an installed model
with the `ollama/` prefix:

```bash
ollama list
heddle --model ollama/llama3.2:latest ask "Reply with exactly: ok"
```

Ollama uses the local OpenAI-compatible endpoint and does not require a hosted
provider API key. The default endpoint is `http://127.0.0.1:11434/v1`.

For other OpenAI-compatible providers, select models with the provider prefix:

```bash
heddle --model lmstudio/local-model ask "Reply with exactly: ok"
heddle --model litellm/gpt-4o-mini ask "Reply with exactly: ok"
heddle --model vllm/meta-llama/Llama-3.3-70B-Instruct ask "Reply with exactly: ok"
heddle --model huggingface/meta-llama/Llama-3.3-70B-Instruct ask "Reply with exactly: ok"
heddle --model openrouter/meta-llama/llama-3.3-70b-instruct ask "Reply with exactly: ok"
heddle --model together/meta-llama/Llama-3.3-70B-Instruct-Turbo ask "Reply with exactly: ok"
heddle --model groq/llama-3.3-70b-versatile ask "Reply with exactly: ok"
```

OpenAI-compatible profiles use `/chat/completions` for execution and `/models`
for shared model picker discovery. Local servers are skipped from pickers when
they are not running. Hosted profiles are skipped until their API key is
configured.

## Environment Variables

Supported provider API-key environment variables:

- `OPENAI_API_KEY` for OpenAI models
- `ANTHROPIC_API_KEY` for Anthropic models
- `HF_TOKEN` or `HUGGINGFACE_API_KEY` for Hugging Face router models
- `OPENROUTER_API_KEY` for OpenRouter models
- `TOGETHER_API_KEY` for Together AI models
- `GROQ_API_KEY` for Groq models

Supported local-provider environment variables:

- `OLLAMA_OPENAI_BASE_URL` to override the OpenAI-compatible Ollama endpoint
- `OLLAMA_BASE_URL` to override the native Ollama base URL; Heddle appends `/v1`
- `OLLAMA_MODEL` for scripts or explicit Ollama provider defaults
- `LMSTUDIO_OPENAI_BASE_URL` or `LMSTUDIO_BASE_URL`; default `http://127.0.0.1:1234/v1`
- `LMSTUDIO_MODEL` for explicit LM Studio provider defaults
- `LITELLM_OPENAI_BASE_URL` or `LITELLM_BASE_URL`; default `http://127.0.0.1:4000/v1`
- `LITELLM_API_KEY` when your LiteLLM gateway requires one
- `LITELLM_MODEL` for explicit LiteLLM provider defaults
- `VLLM_OPENAI_BASE_URL` or `VLLM_BASE_URL`; default `http://127.0.0.1:8000/v1`
- `VLLM_API_KEY` when your vLLM server requires one
- `VLLM_MODEL` for explicit vLLM provider defaults

Supported hosted gateway endpoint overrides:

- `HUGGINGFACE_OPENAI_BASE_URL` or `HF_OPENAI_BASE_URL`; default `https://router.huggingface.co/v1`
- `OPENROUTER_OPENAI_BASE_URL` or `OPENROUTER_BASE_URL`; default `https://openrouter.ai/api/v1`
- `TOGETHER_OPENAI_BASE_URL` or `TOGETHER_BASE_URL`; default `https://api.together.ai/v1`
- `GROQ_OPENAI_BASE_URL` or `GROQ_BASE_URL`; default `https://api.groq.com/openai/v1`
- `HUGGINGFACE_MODEL`, `OPENROUTER_MODEL`, `TOGETHER_MODEL`, or `GROQ_MODEL` for explicit provider defaults

For local development inside this repository, fallback env vars are also accepted:

- `PERSONAL_OPENAI_API_KEY`
- `PERSONAL_ANTHROPIC_API_KEY`

If both a stored OpenAI OAuth credential and an OpenAI API key are available, Heddle prefers OAuth by default. Use `--prefer-api-key` when you want to force Platform API-key mode for a run:

```bash
heddle --prefer-api-key
heddle --prefer-api-key ask "Summarize this repository"
heddle --prefer-api-key daemon
```

## Default Models

Current defaults:

- OpenAI: `gpt-5.4`
- Anthropic: `claude-sonnet-4-6`

OpenAI-compatible profiles have no hardcoded default model because installed,
served, and routed model names vary by machine and account. Select a model with
the provider prefix or set the matching `*_MODEL` variable when a script needs
a provider default.

## Built-In Model Shortlist

OpenAI models currently included in the built-in shortlist:

- `gpt-5.5`, `gpt-5.5-pro`
- `gpt-5.4`, `gpt-5.4-pro`, `gpt-5.4-mini`, `gpt-5.4-nano`
- `gpt-5`, `gpt-5-pro`, `gpt-5-mini`, `gpt-5-nano`
- `gpt-5.2`, `gpt-5.2-pro`, `gpt-5.1`
- `gpt-4.1`, `gpt-4.1-mini`, `gpt-4.1-nano`
- `o3-pro`, `o3`, `o3-mini`, `o4-mini`
- coding-oriented models: `gpt-5.3-codex`, `gpt-5.3-codex-spark`, `gpt-5.2-codex`, `gpt-5.1-codex`, `gpt-5.1-codex-max`, `gpt-5.1-codex-mini`

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
heddle --model ollama/llama3.2:latest ask "Summarize this repository"
heddle --model lmstudio/local-model ask "Summarize this repository"
heddle --model openrouter/meta-llama/llama-3.3-70b-instruct ask "Summarize this repository"
```

In chat, you can also use:

- `/model`
- `/model list`
- `/model set <query>`
- `/model <name>`

When a profiled provider is reachable, `/model set <query>` and the web model
selector include discovered models from that provider. Ollama uses the native
local API, and other OpenAI-compatible profiles use `/models`. Pick one from
the selector, or type it directly with the provider prefix:

```text
/model ollama/llama3.2:latest
/model lmstudio/local-model
/model openrouter/meta-llama/llama-3.3-70b-instruct
```

## OpenAI-Compatible Smoke Tests

Use Ollama as the local baseline when it is installed:

```bash
yarn smoke:ollama
```

Other provider smoke commands are optional and skip cleanly when the local
server or hosted API key is unavailable:

```bash
yarn smoke:lmstudio
yarn smoke:litellm
yarn smoke:vllm
yarn smoke:huggingface
yarn smoke:openrouter
yarn smoke:together
yarn smoke:groq
```

For local servers, start the provider first and make sure at least one chat
model is loaded or served. For hosted providers, set the relevant API key and
optionally the `*_MODEL` variable if `/models` does not return the model you
want to test.

## Local Model Caveats

Local and gateway model behavior depends on the model family, parameter size,
quantization, provider routing, and the hardware or service running the model.
Some smaller, older, or aggressively routed models are useful for chat and
quick experiments but are not reliable at coding-agent tool use.

Watch especially for:

- missing or malformed tool calls
- correct tool calls followed by answers that ignore the tool result
- confident but wrong repository summaries
- slower turns that hit host request timeouts

For important code edits, keep approval prompts enabled, review traces and
diffs carefully, and prefer a stronger local or hosted model when tool-calling
quality matters.

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

The chat footer shows the active credential source for the selected model, such as `auth=openai-oauth`, `auth=openai-key`, `auth=ollama-local`, or `auth=missing-openai`.

In the browser control plane, the same auth indicator appears in the session composer footer so it stays visible without taking space away from the conversation header.

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
- Ollama model names are recognized with `ollama/` or `ollama:` prefixes.
- OpenAI-compatible profile prefixes are `ollama/`, `lmstudio/`, `litellm/`,
  `vllm/`, `huggingface/` or `hf/`, `openrouter/`, `together/`, and `groq/`.
- Gemini model names are recognized by provider inference, but a Google adapter is not wired yet.
- You can pass another supported model name with `--model` if the relevant provider adapter can handle it.
- Hosted web search and image viewing currently require Platform API-key mode for OpenAI.

## See Also

- [CLI reference](cli.md)
- [Chat and sessions](../guides/chat-and-sessions.md)
- [Programmatic use](../guides/programmatic-use.md)
