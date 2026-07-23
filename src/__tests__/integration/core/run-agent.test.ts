import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { AgentRunService } from '../../../core/agent/index.js';
import type { AgentRunEvent } from '../../../core/agent/index.js';
import { ToolApprovalPolicies, type AutopilotProfile } from '../../../core/approvals/index.js';
import { LlmUsageService } from '../../../core/llm/usage/index.js';
import type { ChatMessage, LlmAdapter, LlmResponse } from '../../../core/llm/types.js';
import type { ToolDefinition } from '../../../core/types.js';
import { createLogger } from '../../../core/utils/logger.js';

const silentLogger = createLogger({ level: 'silent', console: false });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

async function runWithRetryTimers(run: () => Promise<Awaited<ReturnType<typeof AgentRunService.run>>>) {
  vi.useFakeTimers();
  try {
    const promise = run();
    await vi.runAllTimersAsync();
    return await promise;
  } finally {
    vi.useRealTimers();
  }
}

describe('AgentRunService.run', () => {
  it('executes tool calls, appends tool output, and finishes with a final answer', async () => {
    const seenMessages: ChatMessage[][] = [];
    const fakeLlm: LlmAdapter = {
      async chat(messages): Promise<LlmResponse> {
        seenMessages.push(messages);

        if (seenMessages.length === 1) {
          return {
            content: 'I will inspect the repo first.',
            toolCalls: [{ id: 'call-1', tool: 'list_files', input: { path: '.' } }],
          };
        }

        return {
          content: 'The repo contains README.md and src/.',
        };
      },
    };

    const listFilesTool: ToolDefinition = {
      name: 'list_files',
      description: 'Lists files in a directory',
      parameters: { type: 'object', properties: {} },
      async execute() {
        return { ok: true, output: 'README.md\nsrc/' };
      },
    };

    const result = await AgentRunService.run({
      goal: 'What is in this repo?',
      llm: fakeLlm,
      tools: [listFilesTool],
      maxSteps: 3,
      logger: silentLogger,
    });

    expect(result.outcome).toBe('done');
    expect(result.summary).toBe('The repo contains README.md and src/.');
    expect(result.transcript).toEqual([
      { role: 'user', content: 'What is in this repo?' },
      {
        role: 'assistant',
        content: 'I will inspect the repo first.',
        toolCalls: [{ id: 'call-1', tool: 'list_files', input: { path: '.' } }],
      },
      {
        role: 'tool',
        content: JSON.stringify({ ok: true, output: 'README.md\nsrc/' }),
        toolCallId: 'call-1',
      },
      { role: 'assistant', content: 'The repo contains README.md and src/.' },
    ]);
    expect(seenMessages).toHaveLength(2);
    expect(seenMessages[1]).toContainEqual({
      role: 'tool',
      content: JSON.stringify({ ok: true, output: 'README.md\nsrc/' }),
      toolCallId: 'call-1',
    });
    expect(result.trace.map((event) => event.type)).toEqual([
      'run.started',
      'assistant.turn',
      'tool.calling',
      'tool.completed',
      'assistant.turn',
      'run.finished',
    ]);
    expect(result.trace[1]).toMatchObject({
      type: 'assistant.turn',
      content: 'I will inspect the repo first.',
      requestedTools: true,
      toolCalls: [{ id: 'call-1', tool: 'list_files', input: { path: '.' } }],
    });
    expect(result.trace[4]).toMatchObject({
      type: 'assistant.turn',
      content: 'The repo contains README.md and src/.',
      requestedTools: false,
    });
  });

  it('records an error outcome when the LLM chat throws a non-retryable error', async () => {
    let calls = 0;
    const providerSecret = 'sk-provider-error-sentinel';
    const fakeLlm: LlmAdapter = {
      async chat(): Promise<LlmResponse> {
        calls += 1;
        throw Object.assign(new Error(`Unauthorized: ${providerSecret}`), { status: 401 });
      },
    };

    const result = await AgentRunService.run({
      goal: 'Handle LLM errors gracefully.',
      llm: fakeLlm,
      tools: [],
      maxSteps: 1,
      logger: silentLogger,
    });

    expect(result.outcome).toBe('error');
    expect(result.summary).toBe('LLM error: Model authentication failed');
    expect(result.failure).toEqual({ source: 'model', code: 'authentication' });
    expect(calls).toBe(1);
    expect(result.trace.at(-1)).toMatchObject({
      type: 'run.finished',
      outcome: 'error',
      failure: { source: 'model', code: 'authentication' },
    });
    expect(JSON.stringify(result)).not.toContain(providerSecret);
  });

  it('finishes structured quota exhaustion without retrying or exposing provider details', async () => {
    let calls = 0;
    const providerSecret = 'provider-quota-sentinel';
    const fakeLlm: LlmAdapter = {
      async chat(): Promise<LlmResponse> {
        calls += 1;
        throw Object.assign(new Error(`Quota response: ${providerSecret}`), {
          code: 'insufficient_quota',
        });
      },
    };

    const result = await AgentRunService.run({
      goal: 'Handle quota exhaustion safely.',
      llm: fakeLlm,
      tools: [],
      maxSteps: 1,
      logger: silentLogger,
    });

    expect(result.outcome).toBe('error');
    expect(result.summary).toBe('LLM error: Model provider quota or billing limit reached');
    expect(result.failure).toEqual({ source: 'model', code: 'quota' });
    expect(calls).toBe(1);
    expect(result.trace.filter((event) => event.type === 'model.retry')).toEqual([]);
    expect(result.trace.at(-1)).toMatchObject({
      type: 'run.finished',
      outcome: 'error',
      failure: { source: 'model', code: 'quota' },
    });
    expect(JSON.stringify(result)).not.toContain(providerSecret);
  });

  it('retries transient LLM transport errors before returning the assistant response', async () => {
    let calls = 0;
    const fakeLlm: LlmAdapter = {
      async chat(): Promise<LlmResponse> {
        calls += 1;

        if (calls < 3) {
          throw Object.assign(new Error('fetch failed'), { status: 503 });
        }

        return {
          content: 'Recovered after reconnecting.',
        };
      },
    };

    const result = await runWithRetryTimers(() => AgentRunService.run({
      goal: 'Handle provider disconnects.',
      llm: fakeLlm,
      tools: [],
      maxSteps: 1,
      logger: silentLogger,
    }));

    expect(result.outcome).toBe('done');
    expect(result.summary).toBe('Recovered after reconnecting.');
    expect(calls).toBe(3);
    expect(result.trace.filter((event) => event.type === 'model.retry')).toEqual([
      expect.objectContaining({
        type: 'model.retry',
        reason: 'transport_error',
        attempt: 1,
        maxAttempts: 5,
        message: 'Model provider is temporarily unavailable',
      }),
      expect.objectContaining({
        type: 'model.retry',
        reason: 'transport_error',
        attempt: 2,
        maxAttempts: 5,
        message: 'Model provider is temporarily unavailable',
      }),
    ]);
  });

  it('retries empty final model responses before returning an error', async () => {
    let calls = 0;
    const fakeLlm: LlmAdapter = {
      async chat(): Promise<LlmResponse> {
        calls += 1;
        return {};
      },
    };

    const result = await runWithRetryTimers(() => AgentRunService.run({
      goal: 'Finish with useful text.',
      llm: fakeLlm,
      tools: [],
      maxSteps: 1,
      logger: silentLogger,
    }));

    expect(result.outcome).toBe('error');
    expect(result.summary).toBe('Model returned an empty response after 3 attempts');
    expect(result.failure).toEqual({ source: 'model', code: 'empty_response' });
    expect(calls).toBe(3);
    expect(result.trace.filter((event) => event.type === 'model.retry')).toHaveLength(2);
  });

  it('does not retry a valid tool-call response without assistant text', async () => {
    let calls = 0;
    const fakeLlm: LlmAdapter = {
      async chat(messages): Promise<LlmResponse> {
        calls += 1;

        if (messages.some((message) => message.role === 'tool')) {
          return {
            content: 'Done after tool use.',
          };
        }

        return {
          toolCalls: [{ id: 'call-1', tool: 'list_files', input: { path: '.' } }],
        };
      },
    };

    const listFilesTool: ToolDefinition = {
      name: 'list_files',
      description: 'Lists files in a directory',
      parameters: { type: 'object', properties: {} },
      async execute() {
        return { ok: true, output: 'README.md\nsrc/' };
      },
    };

    const result = await AgentRunService.run({
      goal: 'Inspect this repo.',
      llm: fakeLlm,
      tools: [listFilesTool],
      maxSteps: 3,
      logger: silentLogger,
    });

    expect(result.outcome).toBe('done');
    expect(result.summary).toBe('Done after tool use.');
    expect(calls).toBe(2);
    expect(result.trace.filter((event) => event.type === 'model.retry')).toHaveLength(0);
  });

  it('records assistant rationale on tool turns when the model provides text with tool calls', async () => {
    const fakeLlm: LlmAdapter = {
      async chat(): Promise<LlmResponse> {
        return {
          content: 'I will inspect the repo root before answering.',
          diagnostics: {
            rationale: 'I will inspect the repo root before answering.',
            missing: ['Need the top-level file listing'],
            wantedTools: ['list_files'],
            wantedInputs: ['path=.'],
          },
          toolCalls: [{ id: 'call-1', tool: 'list_files', input: { path: '.' } }],
        };
      },
    };

    const listFilesTool: ToolDefinition = {
      name: 'list_files',
      description: 'Lists files in a directory',
      parameters: { type: 'object', properties: {} },
      async execute() {
        return { ok: true, output: 'README.md\nsrc/' };
      },
    };

    const result = await AgentRunService.run({
      goal: 'Inspect this repo.',
      llm: fakeLlm,
      tools: [listFilesTool],
      maxSteps: 1,
      logger: silentLogger,
    });

    expect(result.trace[1]).toMatchObject({
      type: 'assistant.turn',
      content: 'I will inspect the repo root before answering.',
      diagnostics: {
        rationale: 'I will inspect the repo root before answering.',
        missing: ['Need the top-level file listing'],
        wantedTools: ['list_files'],
        wantedInputs: ['path=.'],
      },
      requestedTools: true,
    });
  });

  it('does not record an actionless-completion host warning for an intent-only answer', async () => {
    const fakeLlm: LlmAdapter = {
      async chat(): Promise<LlmResponse> {
        return {
          content: 'I will continue in the isolated worktree, inspect the existing E2E harness files and run the Playwright-focused checks to reach a clean handoff point.',
        };
      },
    };

    const result = await AgentRunService.run({
      goal: 'yep, continue on the work',
      llm: fakeLlm,
      tools: [],
      maxSteps: 1,
      logger: silentLogger,
    });

    expect(result.outcome).toBe('done');
    expect(result.trace.map((event) => event.type)).toEqual([
      'run.started',
      'assistant.turn',
      'run.finished',
    ]);
  });

  it('aggregates token usage across model calls', async () => {
    const fakeLlm: LlmAdapter = {
      async chat(messages): Promise<LlmResponse> {
        if (messages.some((message) => message.role === 'tool')) {
          return {
            content: 'Done.',
            usage: LlmUsageService.fromProviderRequest({
              provider: 'anthropic',
              model: 'claude-sonnet-4-6',
              billedInputTokens: 100,
              cachedInputTokens: 40,
              outputTokens: 20,
            }),
          };
        }

        return {
          content: 'Inspecting first.',
          toolCalls: [{ id: 'call-1', tool: 'list_files', input: { path: '.' } }],
          usage: LlmUsageService.fromProviderRequest({
            provider: 'anthropic',
            model: 'claude-haiku-4-5',
            billedInputTokens: 90,
            cachedInputTokens: 20,
            cacheWriteInputTokens: 10,
            outputTokens: 30,
          }),
        };
      },
    };

    const listFilesTool: ToolDefinition = {
      name: 'list_files',
      description: 'Lists files in a directory',
      parameters: { type: 'object', properties: {} },
      async execute() {
        return { ok: true, output: 'README.md\nsrc/' };
      },
    };

    const result = await AgentRunService.run({
      goal: 'Inspect this repo.',
      llm: fakeLlm,
      tools: [listFilesTool],
      maxSteps: 3,
      logger: silentLogger,
    });

    expect(result.usage).toEqual({
      inputTokens: 260,
      billedInputTokens: 190,
      outputTokens: 50,
      totalTokens: 310,
      cachedInputTokens: 60,
      cacheWriteInputTokens: 10,
      requests: 2,
      cost: { status: 'unavailable' },
      byModel: [
        expect.objectContaining({
          provider: 'anthropic',
          model: 'claude-haiku-4-5',
          requests: 1,
        }),
        expect.objectContaining({
          provider: 'anthropic',
          model: 'claude-sonnet-4-6',
          requests: 1,
        }),
      ],
    });
  });

  it('includes usage from retryable model responses', async () => {
    let calls = 0;
    const fakeLlm: LlmAdapter = {
      async chat(): Promise<LlmResponse> {
        calls += 1;
        return {
          content: calls === 3 ? 'Recovered.' : undefined,
          usage: LlmUsageService.fromProviderRequest({
            provider: 'anthropic',
            model: 'claude-sonnet-4-6',
            billedInputTokens: 10,
            outputTokens: calls === 3 ? 2 : 0,
          }),
        };
      },
    };

    const result = await runWithRetryTimers(() => AgentRunService.run({
      goal: 'Retry empty responses.',
      llm: fakeLlm,
      tools: [],
      maxSteps: 1,
      logger: silentLogger,
    }));

    expect(calls).toBe(3);
    expect(result.usage).toMatchObject({
      inputTokens: 30,
      billedInputTokens: 30,
      outputTokens: 2,
      totalTokens: 32,
      requests: 3,
      cost: { status: 'unavailable' },
      byModel: [{
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
        inputTokens: 30,
        billedInputTokens: 30,
        outputTokens: 2,
        totalTokens: 32,
        requests: 3,
        cost: { status: 'unavailable' },
      }],
    });
  });

  it('delivers streamed assistant updates through the agent event lane', async () => {
    const events: AgentRunEvent[] = [];
    const fakeLlm: LlmAdapter = {
      async chat(_messages, _tools, _signal, onStreamEvent): Promise<LlmResponse> {
        onStreamEvent?.({ type: 'content.delta', delta: 'Hello' });
        onStreamEvent?.({ type: 'content.delta', delta: ' world' });
        onStreamEvent?.({ type: 'content.done', content: 'Hello world' });
        return {
          content: 'Hello world',
        };
      },
    };

    const result = await AgentRunService.run({
      goal: 'Say hello.',
      llm: fakeLlm,
      tools: [],
      maxSteps: 1,
      logger: silentLogger,
      onEvent: (event) => events.push(event),
    });

    expect(result.outcome).toBe('done');
    const streamUpdates = events.filter((event) => event.type === 'assistant.stream');
    expect(streamUpdates).toHaveLength(2);
    expect(streamUpdates[0]).toMatchObject({
      step: 1,
      text: 'Hello',
      done: false,
    });
    expect(streamUpdates.at(-1)).toMatchObject({
      step: 1,
      text: 'Hello world',
      done: true,
    });
  });

  it('delivers assistant commentary as a distinct user-facing activity', async () => {
    const events: AgentRunEvent[] = [];
    const fakeLlm: LlmAdapter = {
      async chat(_messages, _tools, _signal, onStreamEvent): Promise<LlmResponse> {
        onStreamEvent?.({
          type: 'commentary.delta',
          messageId: 'commentary-1',
          delta: 'I’m checking the repository ',
        });
        onStreamEvent?.({
          type: 'commentary.done',
          messageId: 'commentary-1',
          text: 'I’m checking the repository before answering.',
        });
        onStreamEvent?.({ type: 'content.done', content: 'Done.' });
        return { content: 'Done.' };
      },
    };

    await AgentRunService.run({
      goal: 'Inspect this repo.',
      llm: fakeLlm,
      tools: [],
      maxSteps: 1,
      logger: silentLogger,
      onEvent: (event) => events.push(event),
    });

    expect(events.filter((event) => event.type === 'assistant.commentary')).toEqual([
      expect.objectContaining({
        type: 'assistant.commentary',
        step: 1,
        messageId: 'commentary-1',
        text: 'I’m checking the repository ',
        done: false,
      }),
      expect.objectContaining({
        type: 'assistant.commentary',
        step: 1,
        messageId: 'commentary-1',
        text: 'I’m checking the repository before answering.',
        done: true,
      }),
    ]);
  });

  it('allows one repeated identical tool call, then blocks excessive repetition', async () => {
    const seenMessages: ChatMessage[][] = [];
    const fakeLlm: LlmAdapter = {
      async chat(messages): Promise<LlmResponse> {
        seenMessages.push(messages);

        if (seenMessages.length < 4) {
          return {
            toolCalls: [{ id: `call-${seenMessages.length}`, tool: 'list_files', input: { path: '.' } }],
          };
        }

        return {
          content: 'I should stop repeating the same directory listing.',
        };
      },
    };

    let executions = 0;
    const listFilesTool: ToolDefinition = {
      name: 'list_files',
      description: 'Lists files in a directory',
      parameters: { type: 'object', properties: {} },
      async execute() {
        executions += 1;
        return { ok: true, output: 'README.md\nsrc/' };
      },
    };

    const result = await AgentRunService.run({
      goal: 'Inspect this repo.',
      llm: fakeLlm,
      tools: [listFilesTool],
      maxSteps: 5,
      logger: silentLogger,
    });

    expect(result.outcome).toBe('done');
    expect(result.summary).toBe('I should stop repeating the same directory listing.');
    expect(executions).toBe(3);
    expect(seenMessages[3]).toContainEqual({
      role: 'tool',
      content: JSON.stringify({
        ok: true,
        output: 'README.md\nsrc/',
      }),
      toolCallId: 'call-3',
    });
    expect(result.trace[9]).toMatchObject({
      type: 'tool.completed',
      call: { tool: 'list_files' },
      result: {
        ok: true,
        output: 'README.md\nsrc/',
      },
    });
  });

  it('normalizes equivalent path spellings but still allows repeated equivalent tool calls', async () => {
    const seenMessages: ChatMessage[][] = [];
    let executions = 0;
    const fakeLlm: LlmAdapter = {
      async chat(messages): Promise<LlmResponse> {
        seenMessages.push(structuredClone(messages));

        if (seenMessages.length === 1) {
          return {
            toolCalls: [{ id: 'call-1', tool: 'list_files', input: { path: '.' } }],
          };
        }

        if (seenMessages.length === 2) {
          return {
            toolCalls: [{ id: 'call-2', tool: 'list_files', input: { path: './' } }],
          };
        }

        if (seenMessages.length === 3) {
          return {
            toolCalls: [{ id: 'call-3', tool: 'list_files', input: { path: '.' } }],
          };
        }

        return {
          content: 'I should stop repeating equivalent directory listings.',
        };
      },
    };

    const listFilesTool: ToolDefinition = {
      name: 'list_files',
      description: 'Lists files in a directory',
      parameters: { type: 'object', properties: {} },
      async execute() {
        executions += 1;
        return { ok: true, output: 'README.md\nsrc/' };
      },
    };

    const result = await AgentRunService.run({
      goal: 'Inspect this repo.',
      llm: fakeLlm,
      tools: [listFilesTool],
      maxSteps: 5,
      logger: silentLogger,
    });

    expect(result.outcome).toBe('done');
    expect(executions).toBe(3);
    expect(seenMessages[3]).toContainEqual({
      role: 'tool',
      content: JSON.stringify({
        ok: true,
        output: 'README.md\nsrc/',
      }),
      toolCallId: 'call-3',
    });
  });

  it('does not stop the run after repeated recoverable tool misuse errors', async () => {
    const seenMessages: ChatMessage[][] = [];
    const fakeLlm: LlmAdapter = {
      async chat(messages): Promise<LlmResponse> {
        seenMessages.push(structuredClone(messages));

        if (seenMessages.length === 1) {
          return {
            toolCalls: [{ id: 'call-1', tool: 'list_files', input: { path: '.', maxEntries: 200 } }],
          };
        }

        if (seenMessages.length === 2) {
          return {
            toolCalls: [{ id: 'call-2', tool: 'list_files', input: { path: '.', maxEntries: 100 } }],
          };
        }

        return {
          content: 'I corrected course instead of dying on invalid list_files parameters.',
        };
      },
    };

    const listFilesTool: ToolDefinition = {
      name: 'list_files',
      description: 'Lists files in a directory',
      parameters: { type: 'object', properties: {} },
      async execute(input) {
        if ('maxEntries' in (input as Record<string, unknown>)) {
          return { ok: false, error: 'Invalid input for list_files. Allowed fields: path. Example: { "path": "." }' };
        }
        return { ok: true, output: 'README.md\nsrc/' };
      },
    };

    const result = await AgentRunService.run({
      goal: 'Inspect this repo.',
      llm: fakeLlm,
      tools: [listFilesTool],
      maxSteps: 4,
      logger: silentLogger,
    });

    expect(result.outcome).toBe('done');
    expect(result.summary).toBe('I corrected course instead of dying on invalid list_files parameters.');
    expect(seenMessages[1]).not.toContainEqual({
      role: 'system',
      content: expect.stringContaining('the last tool call failed due to invalid or repeated tool use'),
    });
  });

  it('continues after 3 consecutive tool errors without injecting a warning', async () => {
    const seenMessages: ChatMessage[][] = [];
    const fakeLlm: LlmAdapter = {
      async chat(messages): Promise<LlmResponse> {
        seenMessages.push(structuredClone(messages));

        if (seenMessages.length <= 3) {
          return {
            toolCalls: [{ id: `call-${seenMessages.length}`, tool: 'list_files', input: { path: '.' } }],
          };
        }

        return {
          content: 'I saw the warning and changed approach instead of being stopped.',
        };
      },
    };

    const listFilesTool: ToolDefinition = {
      name: 'list_files',
      description: 'Lists files in a directory',
      parameters: { type: 'object', properties: {} },
      async execute() {
        return { ok: false, error: 'Transient tool failure while listing files.' };
      },
    };

    const result = await AgentRunService.run({
      goal: 'Inspect this repo.',
      llm: fakeLlm,
      tools: [listFilesTool],
      maxSteps: 5,
      logger: silentLogger,
    });

    expect(result.outcome).toBe('done');
    expect(result.summary).toBe('I saw the warning and changed approach instead of being stopped.');
    expect(seenMessages[3]).not.toContainEqual({
      role: 'system',
      content: expect.stringContaining('there have been 3 consecutive tool errors'),
    });
  });

  it('does not inject a low-step enforcement reminder after extended evidence gathering', async () => {
    const seenMessages: ChatMessage[][] = [];
    const fakeLlm: LlmAdapter = {
      async chat(messages): Promise<LlmResponse> {
        seenMessages.push(structuredClone(messages));

        if (seenMessages.length <= 3) {
          return {
            toolCalls: [{ id: `call-${seenMessages.length}`, tool: 'list_files', input: { path: `path-${seenMessages.length}` } }],
          };
        }

        return {
          content: 'I have enough evidence to stop exploring.',
        };
      },
    };

    const listFilesTool: ToolDefinition = {
      name: 'list_files',
      description: 'Lists files in a directory',
      parameters: { type: 'object', properties: {} },
      async execute() {
        return { ok: true, output: 'README.md\nsrc/' };
      },
    };

    await AgentRunService.run({
      goal: 'Figure out the next concrete step.',
      llm: fakeLlm,
      tools: [listFilesTool],
      maxSteps: 4,
      logger: silentLogger,
    });

    expect(seenMessages[3]).not.toContainEqual({
      role: 'system',
      content: expect.stringContaining('Do not spend another turn rephrasing the plan'),
    });
  });

  it('carries prior transcript into a later turn when history is provided', async () => {
    const seenMessages: ChatMessage[][] = [];
    const fakeLlm: LlmAdapter = {
      async chat(messages): Promise<LlmResponse> {
        seenMessages.push(structuredClone(messages));
        return {
          content: 'I can answer using the earlier conversation context.',
        };
      },
    };

    const result = await AgentRunService.run({
      goal: 'What did I ask before this?',
      llm: fakeLlm,
      tools: [],
      history: [
        { role: 'user', content: 'Inspect the repo root.' },
        { role: 'assistant', content: 'The repo contains README.md and src/.' },
      ],
      maxSteps: 1,
      logger: silentLogger,
    });

    expect(seenMessages[0]).toEqual([
      expect.objectContaining({ role: 'system' }),
      { role: 'user', content: 'Inspect the repo root.' },
      { role: 'assistant', content: 'The repo contains README.md and src/.' },
      { role: 'user', content: 'What did I ask before this?' },
    ]);
    expect(result.transcript).toEqual([
      { role: 'user', content: 'Inspect the repo root.' },
      { role: 'assistant', content: 'The repo contains README.md and src/.' },
      { role: 'user', content: 'What did I ask before this?' },
      { role: 'assistant', content: 'I can answer using the earlier conversation context.' },
    ]);
  });

  it('sanitizes unresolved prior tool calls before sending history back to the model', async () => {
    const seenMessages: ChatMessage[][] = [];
    const fakeLlm: LlmAdapter = {
      async chat(messages): Promise<LlmResponse> {
        seenMessages.push(structuredClone(messages));
        return {
          content: 'I retried without carrying over the interrupted tool call.',
        };
      },
    };

    const result = await AgentRunService.run({
      goal: 'Can you try again?',
      llm: fakeLlm,
      tools: [],
      history: [
        { role: 'user', content: 'Continue on test coverage.' },
        {
          role: 'assistant',
          content: 'I will inspect run-agent next.',
          toolCalls: [{ id: 'call-1', tool: 'read_file', input: { path: 'src/core/agent/service.ts' } }],
        },
      ],
      maxSteps: 1,
      logger: silentLogger,
    });

    expect(seenMessages[0]).toEqual([
      expect.objectContaining({ role: 'system' }),
      { role: 'user', content: 'Continue on test coverage.' },
      { role: 'assistant', content: 'I will inspect run-agent next.' },
      { role: 'user', content: 'Can you try again?' },
    ]);
    expect(result.transcript).toEqual([
      { role: 'user', content: 'Continue on test coverage.' },
      { role: 'assistant', content: 'I will inspect run-agent next.' },
      { role: 'user', content: 'Can you try again?' },
      { role: 'assistant', content: 'I retried without carrying over the interrupted tool call.' },
    ]);
  });

  it('requires approval for tools marked as approval-gated and feeds denials back to the model', async () => {
    const seenMessages: ChatMessage[][] = [];
    const fakeLlm: LlmAdapter = {
      async chat(messages): Promise<LlmResponse> {
        seenMessages.push(structuredClone(messages));

        if (seenMessages.length === 1) {
          return {
            toolCalls: [{ id: 'call-1', tool: 'run_shell_mutate', input: { command: 'yarn test' } }],
          };
        }

        return {
          content: 'The mutation command was denied, so I will stop and report that.',
        };
      },
    };

    const mutateTool: ToolDefinition = {
      name: 'run_shell_mutate',
      description: 'Runs a bounded workspace mutation command',
      requiresApproval: true,
      parameters: { type: 'object', properties: {} },
      async execute() {
        return { ok: true, output: { command: 'yarn test', exitCode: 0, stdout: '', stderr: '' } };
      },
    };

    const result = await AgentRunService.run({
      goal: 'Run tests if needed.',
      llm: fakeLlm,
      tools: [mutateTool],
      maxSteps: 3,
      logger: silentLogger,
      approveToolCall: async () => ({ approved: false, reason: 'User denied in test' }),
    });

    expect(result.outcome).toBe('done');
    expect(seenMessages[1]).toContainEqual({
      role: 'tool',
      content: JSON.stringify({
        ok: false,
        error: 'Approval denied for run_shell_mutate: User denied in test',
      }),
      toolCallId: 'call-1',
    });
    expect(result.trace.map((event) => event.type)).toContain('tool.approval_requested');
    expect(result.trace.map((event) => event.type)).toContain('tool.approval_resolved');
  });

  it('lets custom approval policies satisfy approval-gated tools before human approval', async () => {
    const approveToolCall = vi.fn(async () => ({ approved: false, reason: 'should not be requested' }));
    const fakeLlm: LlmAdapter = {
      async chat(messages): Promise<LlmResponse> {
        if (messages.some((message) => message.role === 'tool')) {
          return { content: 'The command ran through policy approval.' };
        }

        return {
          toolCalls: [{ id: 'call-1', tool: 'run_shell_mutate', input: { command: 'yarn test' } }],
        };
      },
    };

    const mutateTool: ToolDefinition = {
      name: 'run_shell_mutate',
      description: 'Runs a bounded workspace mutation command',
      requiresApproval: true,
      parameters: { type: 'object', properties: {} },
      async execute() {
        return { ok: true, output: { command: 'yarn test', exitCode: 0, stdout: '', stderr: '' } };
      },
    };

    const result = await AgentRunService.run({
      goal: 'Run tests if needed.',
      llm: fakeLlm,
      tools: [mutateTool],
      maxSteps: 3,
      logger: silentLogger,
      approvalPolicies: [
        ({ call }) => call.tool === 'run_shell_mutate' ? { type: 'allow', reason: 'custom CI policy' } : undefined,
      ],
      approveToolCall,
    });

    expect(result.outcome).toBe('done');
    expect(approveToolCall).not.toHaveBeenCalled();
    expect(result.trace.map((event) => event.type)).not.toContain('tool.approval_requested');
    expect(result.trace).toContainEqual(expect.objectContaining({
      type: 'tool.completed',
      call: { id: 'call-1', tool: 'run_shell_mutate', input: { command: 'yarn test' } },
      result: {
        ok: true,
        output: { command: 'yarn test', exitCode: 0, stdout: '', stderr: '' },
      },
      step: 1,
      timestamp: expect.any(String),
    }));
  });

  it('records autonomy decision traces when autopilot denies before human approval', async () => {
    const approveToolCall = vi.fn(async () => ({ approved: true, reason: 'should not be requested' }));
    const fakeLlm: LlmAdapter = {
      async chat(messages): Promise<LlmResponse> {
        if (messages.some((message) => message.role === 'tool')) {
          return { content: 'The destructive command was blocked by autopilot.' };
        }

        return {
          toolCalls: [{
            id: 'call-1',
            tool: 'run_shell_mutate',
            input: {
              command: 'rm -rf ~',
              policy: {
                operations: ['delete'],
                intent: 'cleanup temporary files',
                targetRoots: ['.'],
                expectedEffects: ['cleanup temporary files'],
                maxDestructiveScope: 'single-file',
                environment: 'local',
                confidence: 'high',
              },
            },
          }],
        };
      },
    };
    const profile: AutopilotProfile = {
      mode: 'autopilot',
      roots: [{
        path: '.',
        access: 'autopilot',
        allow: ['read', 'write', 'execute', 'simple-delete'],
      }],
      environments: {
        allow: ['local', 'dev'],
        requireApproval: ['staging', 'production', 'unknown'],
      },
    };
    const mutateTool: ToolDefinition = {
      name: 'run_shell_mutate',
      description: 'Runs a bounded workspace mutation command',
      requiresApproval: true,
      parameters: { type: 'object', properties: {} },
      async execute() {
        return { ok: true, output: 'should not run' };
      },
    };

    const result = await AgentRunService.run({
      goal: 'Clean up temporary files.',
      llm: fakeLlm,
      tools: [mutateTool],
      maxSteps: 3,
      logger: silentLogger,
      approvalPolicies: [ToolApprovalPolicies.autopilot({ profile })],
      approveToolCall,
      workspaceRoot: '/workspace/current',
    });

    expect(result.outcome).toBe('done');
    expect(approveToolCall).not.toHaveBeenCalled();
    expect(result.trace.map((event) => event.type)).toContain('autonomy.decision');
    expect(result.trace.map((event) => event.type)).not.toContain('tool.approval_requested');
    expect(result.trace).toContainEqual(expect.objectContaining({
      type: 'autonomy.decision',
      evaluation: expect.objectContaining({
        decision: expect.objectContaining({
          type: 'deny',
          reason: 'root/home recursive deletion is blocked',
        }),
        envelope: expect.objectContaining({
          operations: ['delete'],
          intent: 'cleanup temporary files',
        }),
        facts: expect.objectContaining({
          command: 'rm -rf ~',
          hardDenyReasons: ['root/home recursive deletion is blocked'],
        }),
      }),
    }));
    expect(result.trace).toContainEqual(expect.objectContaining({
      type: 'tool.completed',
      result: expect.objectContaining({
        ok: false,
        error: 'Approval denied for run_shell_mutate: root/home recursive deletion is blocked',
      }),
    }));
  });

  it('records autonomy postflight traces after autopilot-approved tool execution', async () => {
    const approveToolCall = vi.fn(async () => ({ approved: false, reason: 'should not be requested' }));
    const fakeLlm: LlmAdapter = {
      async chat(messages): Promise<LlmResponse> {
        if (messages.some((message) => message.role === 'tool')) {
          return { content: 'The source file was updated under autopilot.' };
        }

        return {
          toolCalls: [{
            id: 'call-1',
            tool: 'edit_file',
            input: {
              path: 'src/generated.ts',
              content: 'export const value = 1;\n',
              createIfMissing: true,
              policy: {
                operations: ['write'],
                intent: 'Create a generated source file in the current project.',
                targetRoots: ['.'],
                writeRoots: ['.'],
                expectedEffects: ['one generated source file is created'],
                maxDestructiveScope: 'single-file',
                environment: 'local',
                confidence: 'high',
              },
            },
          }],
        };
      },
    };
    const profile: AutopilotProfile = {
      mode: 'autopilot',
      roots: [{
        path: '.',
        access: 'autopilot',
        allow: ['read', 'write'],
      }],
      environments: {
        allow: ['local', 'dev'],
        requireApproval: ['staging', 'production', 'unknown'],
      },
    };
    const editTool: ToolDefinition = {
      name: 'edit_file',
      description: 'Edits files',
      requiresApproval: true,
      parameters: { type: 'object', properties: {} },
      async execute() {
        return { ok: true, output: { path: 'src/generated.ts', action: 'created' } };
      },
    };

    const result = await AgentRunService.run({
      goal: 'Create a generated source file.',
      llm: fakeLlm,
      tools: [editTool],
      maxSteps: 3,
      logger: silentLogger,
      approvalPolicies: [ToolApprovalPolicies.autopilot({ profile })],
      approveToolCall,
      workspaceRoot: '/workspace/current',
    });

    expect(result.outcome).toBe('done');
    expect(approveToolCall).not.toHaveBeenCalled();
    expect(result.trace.map((event) => event.type)).toEqual([
      'run.started',
      'assistant.turn',
      'autonomy.decision',
      'tool.calling',
      'autonomy.postflight',
      'tool.completed',
      'assistant.turn',
      'run.finished',
    ]);
    expect(result.trace).toContainEqual(expect.objectContaining({
      type: 'autonomy.postflight',
      audit: expect.objectContaining({
        call: expect.objectContaining({
          id: 'call-1',
          tool: 'edit_file',
        }),
        observedEffects: {
          changedPaths: ['/workspace/current/src/generated.ts'],
          changedRoots: ['/workspace/current'],
          exceededDeclaredRoots: [],
          gitHistoryChanged: false,
        },
        decision: 'continue',
        reason: 'observed changes stayed within declared write roots',
      }),
    }));
  });

  it('requires approval before reading a file outside the workspace root', async () => {
    const externalRoot = await mkdtemp(join(tmpdir(), 'heddle-read-outside-'));
    const externalFile = join(externalRoot, 'secret.txt');
    await writeFile(externalFile, 'outside\n', 'utf8');

    const fakeLlm: LlmAdapter = {
      async chat(messages): Promise<LlmResponse> {
        if (messages.some((message) => message.role === 'tool')) {
          return {
            content: 'I could not read that file without approval.',
          };
        }

        return {
          toolCalls: [{ id: 'call-1', tool: 'read_file', input: { path: externalFile } }],
        };
      },
    };

    const readTool: ToolDefinition = {
      name: 'read_file',
      description: 'Reads a file',
      parameters: { type: 'object', properties: {} },
      async execute(input) {
        const path = (input as { path: string }).path;
        return { ok: true, output: `read:${path}` };
      },
    };

    const result = await AgentRunService.run({
      goal: 'Read the external file.',
      llm: fakeLlm,
      tools: [readTool],
      maxSteps: 3,
      logger: silentLogger,
      approveToolCall: async () => ({ approved: false, reason: 'Outside workspace read denied in test' }),
    });

    expect(result.outcome).toBe('done');
    expect(result.trace.map((event) => event.type)).toContain('tool.approval_requested');
    expect(result.trace.map((event) => event.type)).toContain('tool.approval_resolved');
    expect(result.trace).toContainEqual({
      type: 'tool.approval_resolved',
      call: { id: 'call-1', tool: 'read_file', input: { path: externalFile } },
      approved: false,
      reason: 'Outside workspace read denied in test',
      step: 1,
      timestamp: expect.any(String),
    });
    expect(result.trace).toContainEqual(expect.objectContaining({
      type: 'tool.completed',
      call: { id: 'call-1', tool: 'read_file', input: { path: externalFile } },
      result: {
        ok: false,
        error: 'Approval denied for read_file: Outside workspace read denied in test',
      },
      step: 1,
      timestamp: expect.any(String),
    }));
  });

  it('does not require approval before reading a file inside the workspace root', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'heddle-read-inside-'));
    const previousCwd = process.cwd();
    process.chdir(workspaceRoot);
    await writeFile(join(workspaceRoot, 'note.txt'), 'inside\n', 'utf8');

    try {
      const fakeLlm: LlmAdapter = {
        async chat(messages): Promise<LlmResponse> {
          if (messages.some((message) => message.role === 'tool')) {
            return {
              content: 'Read completed without approval.',
            };
          }

          return {
            toolCalls: [{ id: 'call-1', tool: 'read_file', input: { path: 'note.txt' } }],
          };
        },
      };

      const readTool: ToolDefinition = {
        name: 'read_file',
        description: 'Reads a file',
        parameters: { type: 'object', properties: {} },
        async execute(input) {
          const path = (input as { path: string }).path;
          return { ok: true, output: `read:${path}` };
        },
      };

      const approveToolCall = vi.fn(async () => ({ approved: true }));
      const result = await AgentRunService.run({
        goal: 'Read the workspace file.',
        llm: fakeLlm,
        tools: [readTool],
        maxSteps: 3,
        logger: silentLogger,
        approveToolCall,
      });

      expect(result.outcome).toBe('done');
      expect(approveToolCall).not.toHaveBeenCalled();
      expect(result.trace.map((event) => event.type)).not.toContain('tool.approval_requested');
    } finally {
      process.chdir(previousCwd);
    }
  });

  it('requires approval before editing a file outside the workspace root', async () => {
    const externalRoot = await mkdtemp(join(tmpdir(), 'heddle-edit-outside-'));
    const externalFile = join(externalRoot, 'outside.txt');

    const fakeLlm: LlmAdapter = {
      async chat(messages): Promise<LlmResponse> {
        if (messages.some((message) => message.role === 'tool')) {
          return {
            content: 'The external edit was denied.',
          };
        }

        return {
          toolCalls: [{ id: 'call-1', tool: 'edit_file', input: { path: externalFile, content: 'hello\n', createIfMissing: true } }],
        };
      },
    };

    const editTool: ToolDefinition = {
      name: 'edit_file',
      description: 'Edits a file directly',
      requiresApproval: true,
      parameters: { type: 'object', properties: {} },
      async execute() {
        return { ok: true, output: { path: externalFile, action: 'created' } };
      },
    };

    const result = await AgentRunService.run({
      goal: 'Edit an external file.',
      llm: fakeLlm,
      tools: [editTool],
      maxSteps: 3,
      logger: silentLogger,
      approveToolCall: async () => ({ approved: false, reason: 'External edit denied in test' }),
    });

    expect(result.outcome).toBe('done');
    expect(result.trace.map((event) => event.type)).toContain('tool.approval_requested');
    expect(result.trace).toContainEqual(expect.objectContaining({
      type: 'tool.completed',
      call: { id: 'call-1', tool: 'edit_file', input: { path: externalFile, content: 'hello\n', createIfMissing: true } },
      result: {
        ok: false,
        error: 'Approval denied for edit_file: External edit denied in test',
      },
      step: 1,
      timestamp: expect.any(String),
    }));
  });

  it('records an explicit fallback event when inspect retries through mutate', async () => {
    const fakeLlm: LlmAdapter = {
      async chat(messages): Promise<LlmResponse> {
        if (messages.some((message) => message.role === 'tool')) {
          return {
            content: 'The fallback command ran successfully.',
          };
        }

        return {
          toolCalls: [{ id: 'call-1', tool: 'run_shell_inspect', input: { command: 'aws configure list' } }],
        };
      },
    };

    const inspectTool: ToolDefinition = {
      name: 'run_shell_inspect',
      description: 'Runs a bounded read-only shell command',
      parameters: { type: 'object', properties: {} },
      async execute() {
        return {
          ok: false,
          error:
            'Command not allowed by run_shell_inspect policy. This tool only permits bounded commands that match its configured workspace risk/scope rules.',
        };
      },
    };

    const mutateTool: ToolDefinition = {
      name: 'run_shell_mutate',
      description: 'Runs an approval-gated shell command',
      requiresApproval: true,
      parameters: { type: 'object', properties: {} },
      async execute(input) {
        const command = (input as { command: string }).command;
        return { ok: true, output: { command, exitCode: 0, stdout: 'ok', stderr: '' } };
      },
    };

    const result = await AgentRunService.run({
      goal: 'Try the AWS CLI command.',
      llm: fakeLlm,
      tools: [inspectTool, mutateTool],
      maxSteps: 3,
      logger: silentLogger,
      approveToolCall: async () => ({ approved: true, reason: 'remembered project approval' }),
    });

    expect(result.outcome).toBe('done');
    expect(result.trace).toContainEqual({
      type: 'tool.fallback',
      fromCall: { id: 'call-1', tool: 'run_shell_inspect', input: { command: 'aws configure list' } },
      toCall: {
        id: 'call-1-mutate-fallback',
        tool: 'run_shell_mutate',
        input: { command: 'aws configure list' },
      },
      reason: 'inspect policy rejected the command',
      step: 1,
      timestamp: expect.any(String),
    });
    expect(result.trace.map((event) => event.type)).toEqual([
      'run.started',
      'assistant.turn',
      'tool.calling',
      'tool.completed',
      'tool.fallback',
      'tool.approval_requested',
      'tool.approval_resolved',
      'tool.calling',
      'tool.completed',
      'assistant.turn',
      'run.finished',
    ]);
  });

  it('reminds about repo review and verification after a workspace-changing action without blocking final answer', async () => {
    const seenMessages: ChatMessage[][] = [];
    const fakeLlm: LlmAdapter = {
      async chat(messages): Promise<LlmResponse> {
        seenMessages.push(structuredClone(messages));
        const hostReminder = [...messages].reverse().find(
          (message: ChatMessage) =>
            message.role === 'system' &&
            message.content.includes('Host requirement: before giving a final answer'),
        );

        if (seenMessages.length === 1) {
          return {
            toolCalls: [{ id: 'call-1', tool: 'run_shell_mutate', input: { command: 'eslint --fix src/example.ts' } }],
          };
        }

        if (!hostReminder) {
          return {
            content: 'The workspace-changing command is complete.',
          };
        }

        if (seenMessages.length === 3) {
          return {
            toolCalls: [{ id: 'call-2', tool: 'run_shell_inspect', input: { command: 'git diff --stat' } }],
          };
        }

        if (seenMessages.length === 4) {
          return {
            toolCalls: [{ id: 'call-3', tool: 'run_shell_mutate', input: { command: 'yarn test' } }],
          };
        }

        return {
          content: 'Applied the fix and verified the repo state.',
        };
      },
    };

    const mutateTool: ToolDefinition = {
      name: 'run_shell_mutate',
      description: 'Runs a bounded workspace mutation or verification command',
      requiresApproval: true,
      parameters: { type: 'object', properties: {} },
      async execute(input) {
        const command = (input as { command: string }).command;
        return { ok: true, output: { command, exitCode: 0, stdout: '', stderr: '' } };
      },
    };

    const inspectTool: ToolDefinition = {
      name: 'run_shell_inspect',
      description: 'Runs a read-only shell inspection command',
      parameters: { type: 'object', properties: {} },
      async execute(input) {
        const command = (input as { command: string }).command;
        return { ok: true, output: { command, exitCode: 0, stdout: '', stderr: '' } };
      },
    };

    const result = await AgentRunService.run({
      goal: 'Apply the fix and tell me it worked.',
      llm: fakeLlm,
      tools: [mutateTool, inspectTool],
      maxSteps: 6,
      logger: silentLogger,
      approveToolCall: async () => ({ approved: true }),
    });

    expect(result.outcome).toBe('done');
    expect(result.summary).toBe('The workspace-changing command is complete.');
    expect(seenMessages[1]).not.toContainEqual({
      role: 'system',
      content: expect.stringContaining('before giving a final answer after a workspace-changing action'),
    });
  });

  it('reminds about post-edit review and verification after edit_file without blocking final answer', async () => {
    const seenMessages: ChatMessage[][] = [];
    const fakeLlm: LlmAdapter = {
      async chat(messages): Promise<LlmResponse> {
        seenMessages.push(structuredClone(messages));

        if (seenMessages.length === 1) {
          return {
            toolCalls: [{ id: 'call-1', tool: 'edit_file', input: { path: 'README.md', oldText: 'old', newText: 'new' } }],
          };
        }

        return {
          content: 'I updated the file.',
        };
      },
    };

    const editTool: ToolDefinition = {
      name: 'edit_file',
      description: 'Edits a file directly in the workspace',
      requiresApproval: true,
      parameters: { type: 'object', properties: {} },
      async execute() {
        return { ok: true, output: { path: 'README.md', action: 'replaced', matchCount: 1 } };
      },
    };

    const inspectTool: ToolDefinition = {
      name: 'run_shell_inspect',
      description: 'Runs a read-only shell inspection command',
      parameters: { type: 'object', properties: {} },
      async execute(input) {
        const command = (input as { command: string }).command;
        return { ok: true, output: { command, exitCode: 0, stdout: '', stderr: '' } };
      },
    };

    const mutateTool: ToolDefinition = {
      name: 'run_shell_mutate',
      description: 'Runs a bounded workspace mutation or verification command',
      requiresApproval: true,
      parameters: { type: 'object', properties: {} },
      async execute(input) {
        const command = (input as { command: string }).command;
        return { ok: true, output: { command, exitCode: 0, stdout: '', stderr: '' } };
      },
    };

    const result = await AgentRunService.run({
      goal: 'Update the README and tell me it worked.',
      llm: fakeLlm,
      tools: [editTool, inspectTool, mutateTool],
      maxSteps: 6,
      logger: silentLogger,
      approveToolCall: async () => ({ approved: true }),
    });

    expect(result.outcome).toBe('done');
    expect(result.summary).toBe('I updated the file.');
    expect(seenMessages[1]).not.toContainEqual({
      role: 'system',
      content: expect.stringContaining('before giving a final answer after a workspace-changing action'),
    });
  });

  it('does not loop when post-mutation review and verification reminders are ignored', async () => {
    const seenMessages: ChatMessage[][] = [];
    let stage = 0;
    const fakeLlm: LlmAdapter = {
      async chat(messages): Promise<LlmResponse> {
        stage += 1;
        seenMessages.push(structuredClone(messages));

        if (stage === 1) {
          return {
            toolCalls: [{ id: 'call-1', tool: 'run_shell_mutate', input: { command: 'eslint --fix src/example.ts' } }],
          };
        }

        if (stage === 2) {
          return {
            content: 'The change is ready to be reported.',
          };
        }

        if (stage === 3) {
          return {
            toolCalls: [{ id: 'call-2', tool: 'run_shell_inspect', input: { command: 'git diff --stat' } }],
          };
        }

        if (stage === 4) {
          return {
            toolCalls: [{ id: 'call-3', tool: 'run_shell_mutate', input: { command: 'yarn test' } }],
          };
        }

        return {
          content: 'Applied the lint fix and checked the repo and test state.',
        };
      },
    };

    const mutateTool: ToolDefinition = {
      name: 'run_shell_mutate',
      description: 'Runs a bounded workspace mutation or verification command',
      requiresApproval: true,
      parameters: { type: 'object', properties: {} },
      async execute(input) {
        const command = (input as { command: string }).command;
        return { ok: true, output: { command, exitCode: 0, stdout: '', stderr: '' } };
      },
    };

    const inspectTool: ToolDefinition = {
      name: 'run_shell_inspect',
      description: 'Runs a read-only shell inspection command',
      parameters: { type: 'object', properties: {} },
      async execute(input) {
        const command = (input as { command: string }).command;
        return { ok: true, output: { command, exitCode: 0, stdout: '', stderr: '' } };
      },
    };

    const result = await AgentRunService.run({
      goal: 'Apply lint fix and summarize.',
      llm: fakeLlm,
      tools: [mutateTool, inspectTool],
      maxSteps: 8,
      logger: silentLogger,
      approveToolCall: async () => ({ approved: true }),
    });

    expect(result.outcome).toBe('done');
    expect(result.summary).toBe('The change is ready to be reported.');

    const hostRequirement = seenMessages
      .flat()
      .find(
        (message) =>
          message.role === 'system' &&
          message.content.includes('Host requirement: before giving a final answer after a workspace-changing action'),
      );
    expect(hostRequirement).toBeUndefined();
  });

  it('does not reopen post-mutation review and verification requirements for git add/commit/push after verification already ran', async () => {
    const seenMessages: ChatMessage[][] = [];
    let stage = 0;
    const fakeLlm: LlmAdapter = {
      async chat(messages): Promise<LlmResponse> {
        stage += 1;
        seenMessages.push(structuredClone(messages));

        if (stage === 1) {
          return {
            toolCalls: [{ id: 'call-1', tool: 'run_shell_mutate', input: { command: 'eslint --fix src/example.ts' } }],
          };
        }

        if (stage === 2) {
          return {
            toolCalls: [{ id: 'call-2', tool: 'run_shell_inspect', input: { command: 'git diff --stat' } }],
          };
        }

        if (stage === 3) {
          return {
            toolCalls: [{ id: 'call-3', tool: 'run_shell_mutate', input: { command: 'yarn test' } }],
          };
        }

        if (stage === 4) {
          return {
            toolCalls: [{ id: 'call-4', tool: 'run_shell_mutate', input: { command: 'git add src/example.ts && git commit -m "fix example" && git push' } }],
          };
        }

        return {
          content: 'Applied the fix, verified it, and pushed it.',
        };
      },
    };

    const mutateTool: ToolDefinition = {
      name: 'run_shell_mutate',
      description: 'Runs a bounded workspace mutation or verification command',
      requiresApproval: true,
      parameters: { type: 'object', properties: {} },
      async execute(input) {
        const command = (input as { command: string }).command;
        return { ok: true, output: { command, exitCode: 0, stdout: '', stderr: '' } };
      },
    };

    const inspectTool: ToolDefinition = {
      name: 'run_shell_inspect',
      description: 'Runs a read-only shell inspection command',
      parameters: { type: 'object', properties: {} },
      async execute(input) {
        const command = (input as { command: string }).command;
        return { ok: true, output: { command, exitCode: 0, stdout: '', stderr: '' } };
      },
    };

    const result = await AgentRunService.run({
      goal: 'Apply fix, verify it, commit, push, and summarize.',
      llm: fakeLlm,
      tools: [mutateTool, inspectTool],
      maxSteps: 8,
      logger: silentLogger,
      approveToolCall: async () => ({ approved: true }),
    });

    expect(result.outcome).toBe('done');
    expect(result.summary).toContain('Applied the fix, verified it, and pushed it.');
    expect(seenMessages.at(-1)?.some((message) => message.role === 'assistant')).toBe(true);
  });

  it('allows a vague final answer after mutation reminder instead of looping', async () => {
    const seenMessages: ChatMessage[][] = [];
    const fakeLlm: LlmAdapter = {
      async chat(messages): Promise<LlmResponse> {
        seenMessages.push(structuredClone(messages));
        const structuredReminder = undefined;

        if (seenMessages.length === 1) {
          return {
            toolCalls: [{ id: 'call-1', tool: 'run_shell_mutate', input: { command: 'eslint --fix src/example.ts' } }],
          };
        }

        if (seenMessages.length === 2) {
          return {
            content: 'The workspace-changing command is complete.',
          };
        }

        if (seenMessages.length === 3) {
          return {
            toolCalls: [{ id: 'call-2', tool: 'run_shell_inspect', input: { command: 'git diff --stat' } }],
          };
        }

        if (seenMessages.length === 4) {
          return {
            toolCalls: [{ id: 'call-3', tool: 'run_shell_mutate', input: { command: 'yarn test' } }],
          };
        }

        if (!structuredReminder) {
          return {
            content: 'I made the change and it looks good.',
          };
        }

        return {
          content: 'Applied the fix and verified the repo state.',
        };
      },
    };

    const mutateTool: ToolDefinition = {
      name: 'run_shell_mutate',
      description: 'Runs a bounded workspace mutation or verification command',
      requiresApproval: true,
      parameters: { type: 'object', properties: {} },
      async execute(input) {
        const command = (input as { command: string }).command;
        return { ok: true, output: { command, exitCode: 0, stdout: '', stderr: '' } };
      },
    };

    const inspectTool: ToolDefinition = {
      name: 'run_shell_inspect',
      description: 'Runs a read-only shell inspection command',
      parameters: { type: 'object', properties: {} },
      async execute(input) {
        const command = (input as { command: string }).command;
        return { ok: true, output: { command, exitCode: 0, stdout: '', stderr: '' } };
      },
    };

    const result = await AgentRunService.run({
      goal: 'Apply the fix and tell me it worked.',
      llm: fakeLlm,
      tools: [mutateTool, inspectTool],
      maxSteps: 8,
      logger: silentLogger,
      approveToolCall: async () => ({ approved: true }),
    });

    expect(result.outcome).toBe('done');
    expect(result.summary).toBe('The workspace-changing command is complete.');
  });

  it('allows a structured summary that omits actual review and verification commands instead of looping', async () => {
    const seenMessages: ChatMessage[][] = [];
    const fakeLlm: LlmAdapter = {
      async chat(messages): Promise<LlmResponse> {
        seenMessages.push(structuredClone(messages));
        const structuredReminder = undefined;

        if (seenMessages.length === 1) {
          return {
            toolCalls: [{ id: 'call-1', tool: 'run_shell_mutate', input: { command: 'eslint --fix src/example.ts' } }],
          };
        }

        if (seenMessages.length === 2) {
          return { content: 'The workspace-changing command is complete.' };
        }

        if (seenMessages.length === 3) {
          return {
            toolCalls: [{ id: 'call-2', tool: 'run_shell_inspect', input: { command: 'git diff --stat' } }],
          };
        }

        if (seenMessages.length === 4) {
          return {
            toolCalls: [{ id: 'call-3', tool: 'run_shell_mutate', input: { command: 'yarn test' } }],
          };
        }

        if (!structuredReminder) {
          return {
            content: 'Applied the fix and checked it.\n- Changed: fixed src/example.ts.\n- Verified: reviewed the repo and tests passed.\n- Remaining uncertainty: none.',
          };
        }

        return {
          content: 'Applied the fix and verified the repo state.',
        };
      },
    };

    const mutateTool: ToolDefinition = {
      name: 'run_shell_mutate',
      description: 'Runs a bounded workspace mutation or verification command',
      requiresApproval: true,
      parameters: { type: 'object', properties: {} },
      async execute(input) {
        const command = (input as { command: string }).command;
        return { ok: true, output: { command, exitCode: 0, stdout: '', stderr: '' } };
      },
    };

    const inspectTool: ToolDefinition = {
      name: 'run_shell_inspect',
      description: 'Runs a read-only shell inspection command',
      parameters: { type: 'object', properties: {} },
      async execute(input) {
        const command = (input as { command: string }).command;
        return { ok: true, output: { command, exitCode: 0, stdout: '', stderr: '' } };
      },
    };

    const result = await AgentRunService.run({
      goal: 'Apply the fix and tell me it worked.',
      llm: fakeLlm,
      tools: [mutateTool, inspectTool],
      maxSteps: 8,
      logger: silentLogger,
      approveToolCall: async () => ({ approved: true }),
    });

    expect(result.outcome).toBe('done');
    expect(result.summary).toBe('The workspace-changing command is complete.');
  });

  it('returns an interrupted outcome when the host requests a stop between steps', async () => {
    let shouldStop = false;
    const fakeLlm: LlmAdapter = {
      async chat(): Promise<LlmResponse> {
        shouldStop = true;
        return {
          toolCalls: [{ id: 'call-1', tool: 'list_files', input: { path: '.' } }],
        };
      },
    };

    const listFilesTool: ToolDefinition = {
      name: 'list_files',
      description: 'Lists files in a directory',
      parameters: { type: 'object', properties: {} },
      async execute() {
        return { ok: true, output: 'README.md\nsrc/' };
      },
    };

    const result = await AgentRunService.run({
      goal: 'Inspect this repo and then stop.',
      llm: fakeLlm,
      tools: [listFilesTool],
      maxSteps: 3,
      logger: silentLogger,
      shouldStop: () => shouldStop,
    });

    expect(result.outcome).toBe('interrupted');
    expect(result.summary).toBe('Run interrupted by host request');
    expect(result.trace[result.trace.length - 1]).toMatchObject({
      type: 'run.finished',
      outcome: 'interrupted',
    });
  });

  it('treats bounded file operations as workspace-changing mutate commands that require review and verification follow-up', async () => {
    const seenMessages: ChatMessage[][] = [];
    const fakeLlm: LlmAdapter = {
      async chat(messages): Promise<LlmResponse> {
        seenMessages.push(structuredClone(messages));
        const hostReminder = [...messages].reverse().find(
          (message: ChatMessage) =>
            message.role === 'system' &&
            message.content.includes('Host requirement: before giving a final answer'),
        );

        if (seenMessages.length === 1) {
          return {
            toolCalls: [{ id: 'call-1', tool: 'run_shell_mutate', input: { command: 'mv docs/old.md docs/new.md' } }],
          };
        }

        if (!hostReminder) {
          return { content: 'I moved the file.' };
        }

        return {
          content:
            'Moved the file and completed the required follow-up checks.\n- Changed: moved docs/old.md to docs/new.md.\n- Verified: git diff --stat reviewed (exit 0); yarn test passed (exit 0).\n- Remaining uncertainty: none.',
        };
      },
    };

    const mutateTool: ToolDefinition = {
      name: 'run_shell_mutate',
      description: 'Runs a bounded workspace mutation or verification command',
      requiresApproval: true,
      parameters: { type: 'object', properties: {} },
      async execute(input) {
        const command = (input as { command: string }).command;
        return { ok: true, output: { command, exitCode: 0, stdout: '', stderr: '' } };
      },
    };

    const result = await AgentRunService.run({
      goal: 'Move the file and tell me the result.',
      llm: fakeLlm,
      tools: [mutateTool],
      maxSteps: 3,
      logger: silentLogger,
      approveToolCall: async () => ({ approved: true }),
    });

    expect(result.outcome).toBe('done');
    expect(result.summary).toBe('I moved the file.');
    expect(seenMessages[1]).not.toContainEqual({
      role: 'system',
      content: expect.stringContaining('before giving a final answer after a workspace-changing action'),
    });
  });

  it('asks for the missing git-native review command when verification already ran after a change', async () => {
    const seenMessages: ChatMessage[][] = [];
    let stage = 0;
    const fakeLlm: LlmAdapter = {
      async chat(messages): Promise<LlmResponse> {
        stage += 1;
        seenMessages.push(structuredClone(messages));

        if (stage === 1) {
          return {
            toolCalls: [{ id: 'call-1', tool: 'run_shell_mutate', input: { command: 'eslint --fix src/example.ts' } }],
          };
        }

        if (stage === 2) {
          return {
            toolCalls: [{ id: 'call-2', tool: 'run_shell_mutate', input: { command: 'yarn test' } }],
          };
        }

        return {
          content: 'The change is done and verified.',
        };
      },
    };

    const mutateTool: ToolDefinition = {
      name: 'run_shell_mutate',
      description: 'Runs a bounded workspace mutation or verification command',
      requiresApproval: true,
      parameters: { type: 'object', properties: {} },
      async execute(input) {
        const command = (input as { command: string }).command;
        return { ok: true, output: { command, exitCode: 0, stdout: '', stderr: '' } };
      },
    };

    const result = await AgentRunService.run({
      goal: 'Apply the fix and report back.',
      llm: fakeLlm,
      tools: [mutateTool],
      maxSteps: 4,
      logger: silentLogger,
      approveToolCall: async () => ({ approved: true }),
    });

    expect(result.outcome).toBe('done');
    expect(result.summary).toBe('The change is done and verified.');
    expect(seenMessages[1]).not.toEqual(
      expect.arrayContaining([
        {
          role: 'system',
          content: expect.stringContaining(
            'Host requirement: before giving a final answer after a workspace-changing action',
          ),
        },
      ]),
    );
  });

  it('asks for the missing git-native review command while noting existing verification evidence', async () => {
    const fakeLlm: LlmAdapter = {
      async chat(): Promise<LlmResponse> {
        return {
          content: 'Done.',
        };
      },
    };

    const result = await AgentRunService.run({
      goal: 'Fix the issue and summarize.',
      llm: fakeLlm,
      tools: [],
      maxSteps: 1,
      logger: silentLogger,
    });

    expect(result.outcome).toBe('done');
    expect(result.summary).toBe('Done.');
  });

  it('allows a final answer even when a recorded plan still has unfinished items', async () => {
    let stage = 0;
    const events: AgentRunEvent[] = [];
    const fakeLlm: LlmAdapter = {
      async chat(): Promise<LlmResponse> {
        stage += 1;

        if (stage === 1) {
          return {
            toolCalls: [{
              id: 'call-1',
              tool: 'update_plan',
              input: {
                explanation: 'Tracking the implementation steps.',
                plan: [
                  { step: 'Inspect current implementation', status: 'completed' },
                  { step: 'Implement the next bounded change', status: 'in_progress' },
                  { step: 'Verify with tests', status: 'pending' },
                ],
              },
            }],
          };
        }

        return {
          content: 'The work is done.',
        };
      },
    };

    const updatePlanTool: ToolDefinition = {
      name: 'update_plan',
      description: 'Records a short working plan.',
      parameters: { type: 'object', properties: {} },
      async execute(input) {
        return { ok: true, output: input };
      },
    };

    const result = await AgentRunService.run({
      goal: 'Implement the next step.',
      llm: fakeLlm,
      tools: [updatePlanTool],
      maxSteps: 2,
      logger: silentLogger,
      onEvent: (event) => events.push(event),
    });

    expect(result.outcome).toBe('done');
    expect(result.summary).toBe('The work is done.');
    expect(
      result.transcript.some(
        (message) =>
          message.role === 'system' &&
          message.content.includes('you recorded a plan and it still has unfinished items'),
      ),
    ).toBe(false);
    expect(events).toContainEqual({
      type: 'plan.updated',
      step: 1,
      explanation: 'Tracking the implementation steps.',
      items: [
        { step: 'Inspect current implementation', status: 'completed' },
        { step: 'Implement the next bounded change', status: 'in_progress' },
        { step: 'Verify with tests', status: 'pending' },
      ],
    });
  });

  it('bounds parallel-safe tool calls and projects mixed results in call order', async () => {
    const started: string[] = [];
    const completed: string[] = [];
    let active = 0;
    let peakActive = 0;
    let modelCalls = 0;
    const gates = new Map([
      ['first', deferred<{ ok: true; output: string }>()],
      ['second', deferred<{ ok: false; error: string }>()],
      ['third', deferred<{ ok: true; output: string }>()],
    ]);
    const fakeLlm: LlmAdapter = {
      info: {
        provider: 'openai',
        model: 'gpt-test',
        capabilities: {
          parallelToolCalls: true,
          reasoningSummaries: false,
          systemMessages: true,
          toolCalls: true,
        },
      },
      async chat(): Promise<LlmResponse> {
        modelCalls++;
        if (modelCalls === 1) {
          return {
            toolCalls: [
              { id: 'call-first', tool: 'parallel_read', input: { id: 'first' } },
              { id: 'call-second', tool: 'parallel_read', input: { id: 'second' } },
              { id: 'call-third', tool: 'parallel_read', input: { id: 'third' } },
            ],
          };
        }
        return { content: 'Finished the reads.' };
      },
    };
    const parallelRead: ToolDefinition = {
      name: 'parallel_read',
      description: 'Reads one independent value.',
      concurrency: 'parallel-safe',
      parameters: { type: 'object', properties: { id: { type: 'string' } } },
      async execute(input) {
        const id = (input as { id: string }).id;
        const gate = gates.get(id);
        if (!gate) {
          throw new Error(`Missing gate for ${id}`);
        }
        started.push(id);
        active++;
        peakActive = Math.max(peakActive, active);
        try {
          return await gate.promise;
        } finally {
          active--;
          completed.push(id);
        }
      },
    };

    const run = AgentRunService.run({
      goal: 'Read three independent values.',
      llm: fakeLlm,
      tools: [parallelRead],
      maxSteps: 2,
      maxToolConcurrency: 2,
      logger: silentLogger,
    });

    await vi.waitFor(() => expect(started).toEqual(['first', 'second']));
    gates.get('second')?.resolve({ ok: false, error: 'second failed' });
    await vi.waitFor(() => expect(started).toEqual(['first', 'second', 'third']));
    gates.get('third')?.resolve({ ok: true, output: 'third result' });
    gates.get('first')?.resolve({ ok: true, output: 'first result' });

    const result = await run;
    expect(result.outcome).toBe('done');
    expect(peakActive).toBe(2);
    expect(completed).toEqual(['second', 'third', 'first']);
    expect(
      result.transcript
        .filter((message) => message.role === 'tool')
        .map((message) => message.toolCallId),
    ).toEqual(['call-first', 'call-second', 'call-third']);
    expect(
      result.transcript
        .filter((message) => message.role === 'tool')
        .map((message) => JSON.parse(message.content)),
    ).toEqual([
      { ok: true, output: 'first result' },
      { ok: false, error: 'second failed' },
      { ok: true, output: 'third result' },
    ]);
  });

  it('resolves every same-response approval before starting allowed calls', async () => {
    const approvalRequests: string[] = [];
    const executions: string[] = [];
    const approvals = new Map([
      ['call-allowed', deferred<{ approved: true }>()],
      ['call-denied', deferred<{ approved: false; reason: string }>()],
    ]);
    let modelCalls = 0;
    const fakeLlm: LlmAdapter = {
      info: {
        provider: 'openai',
        model: 'gpt-test',
        capabilities: {
          parallelToolCalls: true,
          reasoningSummaries: false,
          systemMessages: true,
          toolCalls: true,
        },
      },
      async chat(): Promise<LlmResponse> {
        modelCalls++;
        return modelCalls === 1
          ? {
              toolCalls: [
                { id: 'call-allowed', tool: 'approved_read', input: { id: 'allowed' } },
                { id: 'call-denied', tool: 'approved_read', input: { id: 'denied' } },
              ],
            }
          : { content: 'Approval handling finished.' };
      },
    };
    const approvedRead: ToolDefinition = {
      name: 'approved_read',
      description: 'Reads only after explicit approval.',
      concurrency: 'parallel-safe',
      requiresApproval: true,
      parameters: { type: 'object', properties: { id: { type: 'string' } } },
      async execute(input) {
        const id = (input as { id: string }).id;
        executions.push(id);
        return { ok: true, output: id };
      },
    };

    const run = AgentRunService.run({
      goal: 'Run the approved reads.',
      llm: fakeLlm,
      tools: [approvedRead],
      maxSteps: 2,
      logger: silentLogger,
      approveToolCall: async (call) => {
        approvalRequests.push(call.id);
        const approval = approvals.get(call.id);
        if (!approval) {
          throw new Error(`Missing approval for ${call.id}`);
        }
        return await approval.promise;
      },
    });

    await vi.waitFor(() => expect(approvalRequests).toEqual(['call-allowed']));
    expect(executions).toEqual([]);
    approvals.get('call-allowed')?.resolve({ approved: true });
    await vi.waitFor(() =>
      expect(approvalRequests).toEqual(['call-allowed', 'call-denied']),
    );
    expect(executions).toEqual([]);
    approvals.get('call-denied')?.resolve({
      approved: false,
      reason: 'not needed',
    });

    const result = await run;
    expect(executions).toEqual(['allowed']);
    expect(
      result.transcript
        .filter((message) => message.role === 'tool')
        .map((message) => ({
          id: message.toolCallId,
          result: JSON.parse(message.content),
        })),
    ).toEqual([
      {
        id: 'call-allowed',
        result: { ok: true, output: 'allowed' },
      },
      {
        id: 'call-denied',
        result: { ok: false, error: 'Approval denied for approved_read: not needed' },
      },
    ]);
  });

  it('authorizes serial calls after preceding serial effects', async () => {
    const approvalSnapshots: string[] = [];
    const executions: string[] = [];
    let value = 'initial';
    let modelCalls = 0;
    const fakeLlm: LlmAdapter = {
      info: {
        provider: 'openai',
        model: 'gpt-test',
        capabilities: {
          parallelToolCalls: true,
          reasoningSummaries: false,
          systemMessages: true,
          toolCalls: true,
        },
      },
      async chat(): Promise<LlmResponse> {
        modelCalls++;
        return modelCalls === 1
          ? {
              toolCalls: [
                { id: 'call-first', tool: 'serial_edit', input: { value: 'first' } },
                { id: 'call-second', tool: 'serial_edit', input: { value: 'second' } },
              ],
            }
          : { content: 'Serial edits finished.' };
      },
    };
    const serialEdit: ToolDefinition = {
      name: 'serial_edit',
      description: 'Mutates shared state after explicit approval.',
      requiresApproval: true,
      parameters: { type: 'object', properties: { value: { type: 'string' } } },
      async execute(input) {
        const nextValue = (input as { value: string }).value;
        executions.push(nextValue);
        value = nextValue;
        return { ok: true, output: nextValue };
      },
    };

    const result = await AgentRunService.run({
      goal: 'Apply two serial edits.',
      llm: fakeLlm,
      tools: [serialEdit],
      maxSteps: 2,
      maxToolConcurrency: 2,
      logger: silentLogger,
      approveToolCall: async (call) => {
        approvalSnapshots.push(`${call.id}:${value}`);
        return { approved: true };
      },
    });

    expect(result.outcome).toBe('done');
    expect(approvalSnapshots).toEqual([
      'call-first:initial',
      'call-second:first',
    ]);
    expect(executions).toEqual(['first', 'second']);
  });

  it('aborts all in-flight parallel tool calls and emits one terminal event', async () => {
    const controller = new AbortController();
    const started: string[] = [];
    const seenSignals: AbortSignal[] = [];
    const events: AgentRunEvent[] = [];
    const fakeLlm: LlmAdapter = {
      info: {
        provider: 'openai',
        model: 'gpt-test',
        capabilities: {
          parallelToolCalls: true,
          reasoningSummaries: false,
          systemMessages: true,
          toolCalls: true,
        },
      },
      async chat(): Promise<LlmResponse> {
        return {
          toolCalls: [
            { id: 'call-one', tool: 'cancellable_read', input: { id: 'one' } },
            { id: 'call-two', tool: 'cancellable_read', input: { id: 'two' } },
          ],
        };
      },
    };
    const cancellableRead: ToolDefinition = {
      name: 'cancellable_read',
      description: 'Waits until its host cancels the read.',
      concurrency: 'parallel-safe',
      parameters: { type: 'object', properties: { id: { type: 'string' } } },
      async execute(input, context) {
        const id = (input as { id: string }).id;
        const signal = context?.signal;
        if (!signal) {
          throw new Error('Expected a cancellation signal');
        }
        started.push(id);
        seenSignals.push(signal);
        return await new Promise((resolve) => {
          signal.addEventListener(
            'abort',
            () => resolve({ ok: false, error: `${id} cancelled` }),
            { once: true },
          );
        });
      },
    };

    const run = AgentRunService.run({
      goal: 'Start cancellable reads.',
      llm: fakeLlm,
      tools: [cancellableRead],
      maxSteps: 2,
      maxToolConcurrency: 2,
      abortSignal: controller.signal,
      logger: silentLogger,
      onEvent: (event) => events.push(event),
    });

    await vi.waitFor(() => expect(started).toEqual(['one', 'two']));
    controller.abort();

    const result = await run;
    expect(result.outcome).toBe('interrupted');
    expect(seenSignals).toHaveLength(2);
    expect(seenSignals.every((signal) => signal.aborted)).toBe(true);
    expect(
      events.filter(
        (event) =>
          event.type === 'trace' && event.event.type === 'run.finished',
      ),
    ).toHaveLength(1);
  });

  it.each([
    {
      name: 'the tool has not opted in',
      adapterSupportsParallel: true,
      concurrency: undefined,
    },
    {
      name: 'the adapter does not support parallel calls',
      adapterSupportsParallel: false,
      concurrency: 'parallel-safe' as const,
    },
  ])(
    'keeps calls serial when $name',
    async ({ adapterSupportsParallel, concurrency }) => {
      const started: string[] = [];
      const first = deferred<{ ok: true; output: string }>();
      let modelCalls = 0;
      const fakeLlm: LlmAdapter = {
        info: {
          provider: 'openai',
          model: 'gpt-test',
          capabilities: {
            parallelToolCalls: adapterSupportsParallel,
            reasoningSummaries: false,
            systemMessages: true,
            toolCalls: true,
          },
        },
        async chat(): Promise<LlmResponse> {
          modelCalls++;
          return modelCalls === 1
            ? {
                toolCalls: [
                  { id: 'call-first', tool: 'serial_tool', input: { id: 'first' } },
                  { id: 'call-second', tool: 'serial_tool', input: { id: 'second' } },
                ],
              }
            : { content: 'Serial execution finished.' };
        },
      };
      const serialTool: ToolDefinition = {
        name: 'serial_tool',
        description: 'Uses the default serial policy.',
        parameters: { type: 'object', properties: { id: { type: 'string' } } },
        concurrency,
        async execute(input) {
          const id = (input as { id: string }).id;
          started.push(id);
          return id === 'first'
            ? await first.promise
            : { ok: true, output: id };
        },
      };

      const run = AgentRunService.run({
        goal: 'Run the serial calls.',
        llm: fakeLlm,
        tools: [serialTool],
        maxSteps: 2,
        maxToolConcurrency: 2,
        logger: silentLogger,
      });

      await vi.waitFor(() => expect(started).toEqual(['first']));
      first.resolve({ ok: true, output: 'first' });
      const result = await run;

      expect(result.outcome).toBe('done');
      expect(started).toEqual(['first', 'second']);
    },
  );
});
