#!/usr/bin/env node

const DEFAULT_TIMEOUT_MS = 20_000;

const PROVIDERS = {
  lmstudio: {
    label: 'LM Studio',
    baseURL: 'http://127.0.0.1:1234/v1',
    baseURLEnvs: ['LMSTUDIO_OPENAI_BASE_URL', 'LMSTUDIO_BASE_URL'],
    apiKeyEnvs: ['LMSTUDIO_API_KEY'],
    modelEnv: 'LMSTUDIO_MODEL',
  },
  litellm: {
    label: 'LiteLLM',
    baseURL: 'http://127.0.0.1:4000/v1',
    baseURLEnvs: ['LITELLM_OPENAI_BASE_URL', 'LITELLM_BASE_URL'],
    apiKeyEnvs: ['LITELLM_API_KEY'],
    modelEnv: 'LITELLM_MODEL',
  },
  vllm: {
    label: 'vLLM',
    baseURL: 'http://127.0.0.1:8000/v1',
    baseURLEnvs: ['VLLM_OPENAI_BASE_URL', 'VLLM_BASE_URL'],
    apiKeyEnvs: ['VLLM_API_KEY'],
    modelEnv: 'VLLM_MODEL',
  },
  huggingface: {
    label: 'Hugging Face',
    baseURL: 'https://router.huggingface.co/v1',
    baseURLEnvs: ['HUGGINGFACE_OPENAI_BASE_URL', 'HF_OPENAI_BASE_URL'],
    apiKeyEnvs: ['HF_TOKEN', 'HUGGINGFACE_API_KEY'],
    modelEnv: 'HUGGINGFACE_MODEL',
    requiresApiKey: true,
  },
  openrouter: {
    label: 'OpenRouter',
    baseURL: 'https://openrouter.ai/api/v1',
    baseURLEnvs: ['OPENROUTER_OPENAI_BASE_URL', 'OPENROUTER_BASE_URL'],
    apiKeyEnvs: ['OPENROUTER_API_KEY'],
    modelEnv: 'OPENROUTER_MODEL',
    requiresApiKey: true,
  },
  together: {
    label: 'Together AI',
    baseURL: 'https://api.together.ai/v1',
    baseURLEnvs: ['TOGETHER_OPENAI_BASE_URL', 'TOGETHER_BASE_URL'],
    apiKeyEnvs: ['TOGETHER_API_KEY'],
    modelEnv: 'TOGETHER_MODEL',
    requiresApiKey: true,
  },
  groq: {
    label: 'Groq',
    baseURL: 'https://api.groq.com/openai/v1',
    baseURLEnvs: ['GROQ_OPENAI_BASE_URL', 'GROQ_BASE_URL'],
    apiKeyEnvs: ['GROQ_API_KEY'],
    modelEnv: 'GROQ_MODEL',
    requiresApiKey: true,
  },
};

const args = parseArgs(process.argv.slice(2));
const profile = PROVIDERS[args.profile ?? ''];
if (!profile) {
  console.error(`Usage: node scripts/openai-compatible-smoke.mjs --profile <${Object.keys(PROVIDERS).join('|')}> [--model MODEL] [--skip-when-unavailable]`);
  process.exit(2);
}

const baseURL = trimTrailingSlash(args.baseURL ?? firstEnv(profile.baseURLEnvs) ?? profile.baseURL);
const apiKey = args.apiKey ?? firstEnv(profile.apiKeyEnvs);
const timeoutMs = parsePositiveInt(args.timeoutMs) ?? DEFAULT_TIMEOUT_MS;
const requireToolCalls = Boolean(args.requireToolCalls);
const skipWhenUnavailable = Boolean(args.skipWhenUnavailable);

if (profile.requiresApiKey && !apiKey) {
  finishUnavailable(`missing API key; set one of ${profile.apiKeyEnvs.join(', ')}`);
}

const modelSelection = await resolveModel({
  requestedModel: args.model ?? process.env[profile.modelEnv],
  baseURL,
  apiKey,
  timeoutMs,
});
const model = modelSelection.model;

const checks = [
  {
    name: 'models',
    run: () => requestJson(`${baseURL}/models`, {
      method: 'GET',
      timeoutMs,
      apiKey,
    }),
    summarize: (result) => {
      const models = Array.isArray(result.data) ? result.data.map((entry) => entry?.id).filter(Boolean) : [];
      return models.includes(model) ?
        `found ${model}; available=${models.join(', ')}`
      : `did not find ${model}; available=${models.join(', ') || 'none'}`;
    },
  },
  {
    name: 'chat-completions',
    run: () => requestJson(`${baseURL}/chat/completions`, {
      method: 'POST',
      timeoutMs,
      apiKey,
      body: {
        model,
        messages: [{ role: 'user', content: 'Reply with exactly: ok' }],
        stream: false,
        max_tokens: 8,
      },
    }),
    summarize: (result) => {
      const text = result.choices?.[0]?.message?.content;
      return typeof text === 'string' ? `content=${JSON.stringify(text)}` : 'no assistant content returned';
    },
  },
  {
    name: 'tool-calls',
    run: () => requestJson(`${baseURL}/chat/completions`, {
      method: 'POST',
      timeoutMs,
      apiKey,
      body: {
        model,
        messages: [{ role: 'user', content: 'Use the add tool to add 2 and 3.' }],
        tools: [{
          type: 'function',
          function: {
            name: 'add',
            description: 'Add two numbers.',
            parameters: {
              type: 'object',
              properties: {
                a: { type: 'number' },
                b: { type: 'number' },
              },
              required: ['a', 'b'],
            },
          },
        }],
        tool_choice: 'auto',
        stream: false,
        max_tokens: 64,
      },
    }),
    validate: (result) => validateToolCalls(result, { required: requireToolCalls }),
    summarize: (result) => {
      const toolCalls = result.choices?.[0]?.message?.tool_calls;
      return `tool_calls=${JSON.stringify(toolCalls)}`;
    },
  },
];

const results = [];
for (const check of checks) {
  results.push(await runCheck(check));
}

const failures = results.filter((result) => result.status === 'fail');
console.log([
  `${profile.label} OpenAI-compatible smoke`,
  `baseURL=${baseURL}`,
  `model=${model} (${modelSelection.source})`,
  `timeoutMs=${timeoutMs}`,
  `requireToolCalls=${requireToolCalls}`,
  '',
  ...results.map((result) => `${formatStatus(result.status)} ${result.name}: ${result.message}`),
].join('\n'));

process.exitCode = failures.length > 0 ? 1 : 0;

async function resolveModel(options) {
  if (options.requestedModel) {
    return { model: options.requestedModel, source: 'explicit' };
  }

  try {
    const result = await requestJson(`${options.baseURL}/models`, {
      method: 'GET',
      timeoutMs: options.timeoutMs,
      apiKey: options.apiKey,
    });
    const candidate = Array.isArray(result.data) ?
      result.data.map((entry) => entry?.id).filter((name) => typeof name === 'string' && !isEmbeddingModel(name))[0]
    : undefined;
    if (candidate) {
      return { model: candidate, source: 'auto-selected from OpenAI-compatible /models' };
    }
  } catch (error) {
    finishUnavailable(error instanceof Error ? error.message : String(error));
  }

  throw new Error(`No chat model found. Pass --model or set ${profile.modelEnv}.`);
}

async function runCheck(check) {
  try {
    const result = await check.run();
    const validation = check.validate?.(result);
    return {
      name: check.name,
      status: validation?.status ?? 'pass',
      message: validation?.message ?? check.summarize(result),
    };
  } catch (error) {
    return {
      name: check.name,
      status: 'fail',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

function validateToolCalls(result, options) {
  const toolCalls = result.choices?.[0]?.message?.tool_calls;
  if (Array.isArray(toolCalls) && toolCalls.length > 0) {
    return undefined;
  }

  const content = result.choices?.[0]?.message?.content;
  const message =
    typeof content === 'string' && content.trim() ?
      `no tool calls returned; content=${JSON.stringify(content)}`
    : 'no tool calls returned';

  return {
    status: options.required ? 'fail' : 'warn',
    message,
  };
}

async function requestJson(url, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await fetch(url, {
      method: options.method,
      signal: controller.signal,
      headers: {
        ...(options.body ? { 'content-type': 'application/json' } : {}),
        ...(options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}: ${text || 'no response body'}`);
    }
    return text.trim() ? JSON.parse(text) : {};
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`timed out after ${options.timeoutMs}ms`, { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function finishUnavailable(message) {
  if (!skipWhenUnavailable) {
    throw new Error(message);
  }

  console.log([
    `${profile.label} OpenAI-compatible smoke`,
    `SKIP unavailable: ${message}`,
  ].join('\n'));
  process.exit(0);
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    const next = values[index + 1];
    if (value === '--profile' && next) {
      parsed.profile = next;
      index += 1;
      continue;
    }
    if (value === '--base-url' && next) {
      parsed.baseURL = next;
      index += 1;
      continue;
    }
    if (value === '--model' && next) {
      parsed.model = next;
      index += 1;
      continue;
    }
    if (value === '--api-key' && next) {
      parsed.apiKey = next;
      index += 1;
      continue;
    }
    if (value === '--timeout-ms' && next) {
      parsed.timeoutMs = next;
      index += 1;
      continue;
    }
    if (value === '--require-tool-calls') {
      parsed.requireToolCalls = true;
      continue;
    }
    if (value === '--skip-when-unavailable') {
      parsed.skipWhenUnavailable = true;
    }
  }
  return parsed;
}

function firstEnv(names) {
  return names.map((name) => process.env[name]).find((value) => typeof value === 'string' && value.trim().length > 0);
}

function isEmbeddingModel(name) {
  const normalized = name.toLowerCase();
  return ['embed', 'embedding', 'nomic-embed', 'bge', 'clip'].some((part) => normalized.includes(part));
}

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, '');
}

function formatStatus(status) {
  return status === 'pass' ? 'PASS' : status === 'warn' ? 'WARN' : 'FAIL';
}

function parsePositiveInt(value) {
  if (typeof value !== 'string') {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
