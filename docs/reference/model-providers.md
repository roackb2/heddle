# Model Providers

Heddle supports a broad family of model providers. Use this page when you want
the quick compatibility matrix: provider family, model prefix, access mode, and
how to test it.

For setup details, environment variables, and model-picker behavior, see
[Providers and models](providers-and-models.md).

## Supported Provider Families

| Provider family | Model prefix | Access mode | Model discovery | Smoke test |
| --- | --- | --- | --- | --- |
| OpenAI | `gpt-*`, `o*` | OpenAI account sign-in or `OPENAI_API_KEY` | Built-in curated shortlist | Use a normal `heddle --model ... ask` run |
| Anthropic Claude | `claude-*` | `ANTHROPIC_API_KEY` | Built-in curated shortlist | Use a normal `heddle --model ... ask` run |
| Ollama | `ollama/` or `ollama:` | Local endpoint, no hosted key required | Native Ollama `/api/tags` | `yarn smoke:ollama` |
| LM Studio | `lmstudio/` | Local OpenAI-compatible endpoint | `/models` when the server is running | `yarn smoke:lmstudio` |
| LiteLLM | `litellm/` | OpenAI-compatible gateway, optional gateway key | `/models` when the gateway is reachable | `yarn smoke:litellm` |
| vLLM | `vllm/` | Self-hosted OpenAI-compatible endpoint, optional server key | `/models` when the server is running | `yarn smoke:vllm` |
| Hugging Face router | `huggingface/` or `hf/` | `HF_TOKEN` or `HUGGINGFACE_API_KEY` | `/models` when the API key is configured | `yarn smoke:huggingface` |
| OpenRouter | `openrouter/` | `OPENROUTER_API_KEY` | `/models` when the API key is configured | `yarn smoke:openrouter` |
| Together AI | `together/` | `TOGETHER_API_KEY` | `/models` when the API key is configured | `yarn smoke:together` |
| Groq | `groq/` | `GROQ_API_KEY` | `/models` when the API key is configured | `yarn smoke:groq` |

## Example Model Selection

```bash
heddle --model gpt-5.4-mini ask "Summarize this repository"
heddle --model claude-sonnet-4-6 ask "Summarize this repository"
heddle --model ollama/llama3.2:latest ask "Summarize this repository"
heddle --model lmstudio/local-model ask "Summarize this repository"
heddle --model openrouter/meta-llama/llama-3.3-70b-instruct ask "Summarize this repository"
```

In terminal chat, use `/model set <query>` to search the shared model-options
list. The browser model selector uses the same list.

## Quality Caveat

Provider compatibility means Heddle can route requests and tool definitions to
that provider. It does not mean every model behind that provider is equally good
at coding-agent work.

Smaller, older, heavily quantized, local, or aggressively routed models may:

- miss tool calls or return malformed tool calls;
- call tools correctly but ignore tool results;
- answer confidently with incorrect repository facts;
- run slowly enough to hit request timeouts.

For important edits, keep approval prompts enabled, review traces and diffs,
and prefer stronger models when tool-calling quality matters.
