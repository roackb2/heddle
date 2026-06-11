#!/usr/bin/env node

const DEFAULT_BASE_URL = 'http://127.0.0.1:11434/v1';
const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_PREFERRED_MODEL_BYTES = 8 * 1024 * 1024 * 1024;

const args = parseArgs(process.argv.slice(2));
const baseURL = trimTrailingSlash(args.baseURL ?? process.env.OLLAMA_OPENAI_BASE_URL ?? DEFAULT_BASE_URL);
const timeoutMs = parsePositiveInt(args.timeoutMs ?? process.env.OLLAMA_SMOKE_TIMEOUT_MS) ?? DEFAULT_TIMEOUT_MS;
const requireToolCalls = Boolean(args.requireToolCalls);
const requestedModel = args.model ?? process.env.OLLAMA_MODEL;
const modelSelection = requestedModel ?
  { model: requestedModel, source: 'explicit' }
: await resolveSmokeModel({ baseURL, timeoutMs });
const model = modelSelection.model;

const checks = [
  {
    name: 'models',
    run: () => requestJson(`${baseURL}/models`, {
      method: 'GET',
      timeoutMs,
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
  `Ollama OpenAI-compatible smoke`,
  `baseURL=${baseURL}`,
  `model=${model} (${modelSelection.source})`,
  `timeoutMs=${timeoutMs}`,
  `requireToolCalls=${requireToolCalls}`,
  '',
  ...results.map((result) => `${formatStatus(result.status)} ${result.name}: ${result.message}`),
].join('\n'));

process.exitCode = failures.length > 0 ? 1 : 0;

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

async function resolveSmokeModel(options) {
  const tagsURL = `${ollamaNativeBaseURL(options.baseURL)}/api/tags`;
  try {
    const result = await requestJson(tagsURL, {
      method: 'GET',
      timeoutMs: options.timeoutMs,
    });
    const candidates = Array.isArray(result.models) ?
      result.models.flatMap((entry) => toSmokeModelCandidate(entry))
    : [];
    const selected = selectSmokeModel(candidates);
    if (selected) {
      return {
        model: selected.name,
        source: selected.size ?
          `auto-selected from installed models, size=${formatBytes(selected.size)}`
        : 'auto-selected from installed models',
      };
    }
  } catch (error) {
    console.warn(`WARN model-discovery: ${error instanceof Error ? error.message : String(error)}`);
  }

  const models = await requestJson(`${options.baseURL}/models`, {
    method: 'GET',
    timeoutMs: options.timeoutMs,
  });
  const candidate = Array.isArray(models.data) ?
    models.data.map((entry) => entry?.id).filter((name) => typeof name === 'string' && !isEmbeddingModel(name))[0]
  : undefined;
  if (candidate) {
    return { model: candidate, source: 'auto-selected from OpenAI-compatible /models' };
  }

  throw new Error('No installed Ollama chat model found. Install one with `ollama pull <model>` or pass --model.');
}

function toSmokeModelCandidate(entry) {
  if (!entry || typeof entry !== 'object' || typeof entry.name !== 'string' || isEmbeddingModel(entry.name)) {
    return [];
  }

  const size = typeof entry.size === 'number' && Number.isFinite(entry.size) ? entry.size : undefined;
  return [{
    name: entry.name,
    size,
    preference: smokeModelPreference(entry.name),
  }];
}

function selectSmokeModel(candidates) {
  const preferredSize = candidates.filter((candidate) => !candidate.size || candidate.size <= MAX_PREFERRED_MODEL_BYTES);
  const pool = preferredSize.length > 0 ? preferredSize : candidates;
  const sorted = pool.toSorted((left, right) =>
    left.preference - right.preference
    || (left.size ?? Number.MAX_SAFE_INTEGER) - (right.size ?? Number.MAX_SAFE_INTEGER)
    || left.name.localeCompare(right.name));
  return sorted[0];
}

function smokeModelPreference(name) {
  const normalized = name.toLowerCase();
  const preferences = [
    'llama3.2',
    'llama3.1',
    'qwen3',
    'qwen2.5',
    'mistral',
    'gemma3',
    'phi4-mini',
    'phi3',
  ];
  const index = preferences.findIndex((prefix) => normalized.startsWith(prefix));
  return index >= 0 ? index : preferences.length;
}

function isEmbeddingModel(name) {
  const normalized = name.toLowerCase();
  return ['embed', 'embedding', 'nomic-embed', 'bge', 'clip'].some((part) => normalized.includes(part));
}

async function requestJson(url, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await fetch(url, {
      method: options.method,
      signal: controller.signal,
      headers: options.body ? { 'content-type': 'application/json' } : undefined,
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

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    const next = values[index + 1];
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
    if (value === '--timeout-ms' && next) {
      parsed.timeoutMs = next;
      index += 1;
      continue;
    }
    if (value === '--require-tool-calls') {
      parsed.requireToolCalls = true;
    }
  }
  return parsed;
}

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, '');
}

function ollamaNativeBaseURL(value) {
  return trimTrailingSlash(value).replace(/\/v1$/i, '');
}

function formatBytes(value) {
  const gib = value / (1024 * 1024 * 1024);
  return `${gib.toFixed(gib >= 10 ? 0 : 1)}GiB`;
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
