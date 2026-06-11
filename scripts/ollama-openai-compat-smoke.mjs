#!/usr/bin/env node

const DEFAULT_BASE_URL = 'http://127.0.0.1:11434/v1';
const DEFAULT_MODEL = 'qwen3:8b';
const DEFAULT_TIMEOUT_MS = 20_000;

const args = parseArgs(process.argv.slice(2));
const baseURL = trimTrailingSlash(args.baseURL ?? process.env.OLLAMA_OPENAI_BASE_URL ?? DEFAULT_BASE_URL);
const model = args.model ?? process.env.OLLAMA_MODEL ?? DEFAULT_MODEL;
const timeoutMs = parsePositiveInt(args.timeoutMs ?? process.env.OLLAMA_SMOKE_TIMEOUT_MS) ?? DEFAULT_TIMEOUT_MS;

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
    summarize: (result) => {
      const toolCalls = result.choices?.[0]?.message?.tool_calls;
      return Array.isArray(toolCalls) && toolCalls.length > 0 ?
        `tool_calls=${JSON.stringify(toolCalls)}`
      : 'no tool calls returned';
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
  `model=${model}`,
  `timeoutMs=${timeoutMs}`,
  '',
  ...results.map((result) => `${result.status === 'pass' ? 'PASS' : 'FAIL'} ${result.name}: ${result.message}`),
].join('\n'));

process.exitCode = failures.length > 0 ? 1 : 0;

async function runCheck(check) {
  try {
    const result = await check.run();
    return {
      name: check.name,
      status: 'pass',
      message: check.summarize(result),
    };
  } catch (error) {
    return {
      name: check.name,
      status: 'fail',
      message: error instanceof Error ? error.message : String(error),
    };
  }
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
    }
  }
  return parsed;
}

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, '');
}

function parsePositiveInt(value) {
  if (typeof value !== 'string') {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
