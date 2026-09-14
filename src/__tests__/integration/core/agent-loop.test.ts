import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { AgentLoopCheckpointService, AgentLoopRuntimeService } from '@/core/runtime/loop/index.js';
import { RuntimeToolService } from '@/core/runtime/tools/index.js';
import { ToolBundleComposer, type ToolToolkit } from '@/core/tools/index.js';
import { AgentSkillService, FileAgentSkillActivationRepository } from '@/core/skills/index.js';
import { ProviderCredentialRepository } from '@/core/auth/index.js';
import { LlmAdapterService } from '@/core/llm/index.js';
import type { ChatMessage, LlmAdapter, LlmResponse } from '../../../core/llm/types.js';
import type { AgentHeartbeatEvent, AgentLoopEvent, ToolDefinition } from '../../../advanced.js';
import { memoryToolkit } from '../../../index.js';
import { createLogger } from '../../../core/utils/logger.js';
import {
  HeartbeatDecisionPolicy,
  HeartbeatRunnerAgent,
  StoredHeartbeatService,
  type HeartbeatCheckpointStore,
} from '@/core/heartbeat/index.js';

const silentLogger = createLogger({ level: 'silent', console: false });

describe('AgentLoopRuntimeService.run', () => {
  it('keeps the built-in coding prompt when prompt composition is omitted', async () => {
    const seenMessages: ChatMessage[][] = [];
    const fakeLlm: LlmAdapter = {
      info: {
        provider: 'openai',
        model: 'gpt-test',
        capabilities: {
          toolCalls: true,
          systemMessages: true,
          reasoningSummaries: false,
          parallelToolCalls: true,
        },
      },
      async chat(messages): Promise<LlmResponse> {
        seenMessages.push(structuredClone(messages));
        return { content: 'Done.' };
      },
    };

    await AgentLoopRuntimeService.run({
      goal: 'Inspect the repository.',
      systemContext: 'HOST_CONTEXT_SENTINEL',
      llm: fakeLlm,
      tools: [],
      includeDefaultTools: false,
      maxSteps: 1,
      logger: silentLogger,
    });

    expect(seenMessages[0]?.[0]).toMatchObject({
      role: 'system',
      content: expect.stringContaining('You are Heddle, a task-owning coding and workspace agent.'),
    });
    expect(seenMessages[0]?.[0]?.content).toContain('HOST_CONTEXT_SENTINEL');
    expect(seenMessages[0]?.at(-1)).toEqual({
      role: 'user',
      content: 'Inspect the repository.',
    });
  });

  it('passes an exact host-owned system prompt without Heddle prompt composition', async () => {
    const seenMessages: ChatMessage[][] = [];
    const systemPrompt = 'You are the product-owned agent.\n\nUse only the supplied capability.\n';
    const fakeLlm: LlmAdapter = {
      info: {
        provider: 'openai',
        model: 'gpt-test',
        capabilities: {
          toolCalls: true,
          systemMessages: true,
          reasoningSummaries: false,
          parallelToolCalls: true,
        },
      },
      async chat(messages): Promise<LlmResponse> {
        seenMessages.push(structuredClone(messages));
        return { content: 'Done.' };
      },
    };
    const readAgentSkillTool: ToolDefinition = {
      name: 'read_agent_skill',
      description: 'Read a host-selected skill.',
      parameters: { type: 'object', properties: {} },
      execute: async () => ({ ok: true, output: 'unused' }),
    };

    await AgentLoopRuntimeService.run({
      goal: 'Complete the product-owned task.',
      systemContext: 'THIS_APPENDIX_MUST_NOT_BE_VISIBLE',
      promptComposition: { mode: 'host-owned', systemPrompt },
      llm: fakeLlm,
      tools: [readAgentSkillTool],
      includeDefaultTools: false,
      maxSteps: 1,
      logger: silentLogger,
    });

    expect(seenMessages[0]).toEqual([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: 'Complete the product-owned task.' },
    ]);
  });

  it('removes restored system messages from host-owned model history', async () => {
    const seenMessages: ChatMessage[][] = [];
    const systemPrompt = 'You are the current product-owned agent.';
    const fakeLlm: LlmAdapter = {
      async chat(messages): Promise<LlmResponse> {
        seenMessages.push(structuredClone(messages));
        return { content: 'Done.' };
      },
    };

    await AgentLoopRuntimeService.run({
      goal: 'Continue the durable task.',
      promptComposition: { mode: 'host-owned', systemPrompt },
      history: [
        { role: 'system', content: 'STALE_HEDDLE_SYSTEM_PROMPT' },
        { role: 'user', content: 'Earlier durable task.' },
        { role: 'assistant', content: 'Earlier progress.' },
      ],
      llm: fakeLlm,
      tools: [],
      includeDefaultTools: false,
      maxSteps: 1,
      logger: silentLogger,
    });

    expect(seenMessages[0]).toEqual([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: 'Earlier durable task.' },
      { role: 'assistant', content: 'Earlier progress.' },
      { role: 'user', content: 'Continue the durable task.' },
    ]);
  });

  it('does not inject Heddle memory reminders during a host-owned run', async () => {
    const seenMessages: ChatMessage[][] = [];
    const systemPrompt = 'You are the product-owned agent.';
    const fakeLlm: LlmAdapter = {
      async chat(messages): Promise<LlmResponse> {
        seenMessages.push(structuredClone(messages));
        if (seenMessages.length === 1) {
          return {
            toolCalls: [{ id: 'inspect-1', tool: 'inspect_project', input: {} }],
          };
        }
        return { content: 'Inspection complete.' };
      },
    };
    const tools: ToolDefinition[] = [
      {
        name: 'inspect_project',
        description: 'Inspect the current project.',
        parameters: { type: 'object', properties: {} },
        execute: async () => ({ ok: true, output: 'Project inspected.' }),
      },
      {
        name: 'memory_checkpoint',
        description: 'Record or skip a memory checkpoint.',
        parameters: { type: 'object', properties: {} },
        execute: async () => ({ ok: true, output: 'Not called.' }),
      },
    ];

    await AgentLoopRuntimeService.run({
      goal: 'Inspect the current project.',
      promptComposition: { mode: 'host-owned', systemPrompt },
      llm: fakeLlm,
      tools,
      includeDefaultTools: false,
      maxSteps: 2,
      logger: silentLogger,
    });

    expect(seenMessages).toHaveLength(2);
    for (const messages of seenMessages) {
      expect(messages.filter((message) => message.role === 'system')).toEqual([
        { role: 'system', content: systemPrompt },
      ]);
    }
    expect(JSON.stringify(seenMessages)).not.toContain(
      'Before your final answer, call memory_checkpoint',
    );
  });

  it('rejects a blank host-owned system prompt before calling the model', async () => {
    const chat = vi.fn(async (): Promise<LlmResponse> => ({ content: 'Unexpected.' }));
    const onEvent = vi.fn();
    const fakeLlm: LlmAdapter = {
      info: {
        provider: 'openai',
        model: 'gpt-test',
        capabilities: {
          toolCalls: true,
          systemMessages: true,
          reasoningSummaries: false,
          parallelToolCalls: true,
        },
      },
      chat,
    };

    await expect(AgentLoopRuntimeService.run({
      goal: 'Complete the product-owned task.',
      promptComposition: { mode: 'host-owned', systemPrompt: '   ' },
      llm: fakeLlm,
      tools: [],
      includeDefaultTools: false,
      maxSteps: 1,
      logger: silentLogger,
      onEvent,
    })).rejects.toThrow('Host-owned system prompt must be non-empty.');

    expect(chat).not.toHaveBeenCalled();
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('constructs an exact host toolkit with the run-scoped OAuth credential', async () => {
    const root = await mkdtemp(join(tmpdir(), 'heddle-run-toolkit-credential-'));
    const credentialStorePath = join(root, 'auth.json');
    new ProviderCredentialRepository({ storePath: credentialStorePath }).set({
      type: 'oauth',
      provider: 'openai',
      accessToken: 'stored-access-token',
      refreshToken: 'stored-refresh-token',
      expiresAt: Date.now() + 120_000,
      accountId: 'account-123',
      createdAt: '2026-09-07T00:00:00.000Z',
      updatedAt: '2026-09-07T00:00:00.000Z',
    });

    let adapterCredential: unknown;
    let toolkitCredential: unknown;
    let toolkitCredentialSource: unknown;
    let modelVisibleTools: string[] = [];
    const fakeLlm: LlmAdapter = {
      info: {
        provider: 'openai',
        model: 'gpt-5.4',
        capabilities: {
          toolCalls: true,
          systemMessages: true,
          reasoningSummaries: false,
          parallelToolCalls: true,
        },
      },
      async chat(_messages, tools): Promise<LlmResponse> {
        modelVisibleTools = tools.map((tool) => tool.name);
        return { content: 'Done.' };
      },
    };
    const createLlm = vi.spyOn(LlmAdapterService, 'create').mockImplementation((input) => {
      adapterCredential = input.credentials?.credential;
      return fakeLlm;
    });
    const toolkit: ToolToolkit = {
      id: 'host-project-context',
      createTools(context) {
        toolkitCredential = context.credential;
        toolkitCredentialSource = context.providerCredentialSource;
        return [{
          name: 'host_context_read',
          description: 'Read bounded host context.',
          parameters: { type: 'object', properties: {} },
          execute: async () => ({ ok: true, output: 'context' }),
        }];
      },
    };

    try {
      const result = await AgentLoopRuntimeService.run({
        goal: 'Answer from bounded context.',
        model: 'gpt-5.4',
        credentialStorePath,
        includeDefaultTools: false,
        toolkits: [toolkit],
        maxSteps: 1,
        logger: silentLogger,
        workspaceRoot: root,
      });

      expect(result.outcome).toBe('done');
    } finally {
      createLlm.mockRestore();
    }

    expect(adapterCredential).toMatchObject({
      type: 'oauth-access-token',
      provider: 'openai',
      accessToken: 'stored-access-token',
      accountId: 'account-123',
    });
    expect(toolkitCredential).toBe(adapterCredential);
    expect(toolkitCredentialSource).toMatchObject({
      type: 'oauth-access-token',
      provider: 'openai',
      accountId: 'account-123',
    });
    expect(modelVisibleTools).toEqual(['host_context_read']);
  });

  it('serializes async event listeners and settles them before the run resolves', async () => {
    let releaseFirst!: () => void;
    const firstWrite = new Promise<void>((resolveFirst) => {
      releaseFirst = resolveFirst;
    });
    const entered: string[] = [];
    const completed: string[] = [];
    let first = true;
    let runSettled = false;
    const fakeLlm: LlmAdapter = {
      info: {
        provider: 'openai',
        model: 'gpt-test',
        capabilities: {
          toolCalls: true,
          systemMessages: true,
          reasoningSummaries: false,
          parallelToolCalls: true,
        },
      },
      async chat(): Promise<LlmResponse> {
        return { content: 'Done.' };
      },
    };

    const run = AgentLoopRuntimeService.run({
      goal: 'Complete one turn.',
      llm: fakeLlm,
      tools: [],
      includeDefaultTools: false,
      maxSteps: 1,
      logger: silentLogger,
      onEvent: async (event) => {
        entered.push(event.type);
        if (first) {
          first = false;
          await firstWrite;
        }
        completed.push(event.type);
      },
    });
    void run.then(() => {
      runSettled = true;
    });

    await new Promise<void>((resolveTurn) => setImmediate(resolveTurn));
    expect(entered).toEqual(['loop.started']);
    expect(completed).toEqual([]);
    expect(runSettled).toBe(false);

    releaseFirst();
    await run;

    expect(entered).toEqual(completed);
    expect(completed.at(-1)).toBe('loop.finished');
    expect(runSettled).toBe(true);
  });

  it('awaits ordered return-direct tool completion before loop.finished', async () => {
    let releaseToolCompletion!: () => void;
    const toolCompletionPersisted = new Promise<void>((resolveCompletion) => {
      releaseToolCompletion = resolveCompletion;
    });
    const entered: string[] = [];
    const completed: string[] = [];
    let runSettled = false;
    let modelCalls = 0;
    const fakeLlm: LlmAdapter = {
      info: {
        provider: 'openai',
        model: 'gpt-test',
        capabilities: {
          toolCalls: true,
          systemMessages: true,
          reasoningSummaries: false,
          parallelToolCalls: true,
        },
      },
      async chat(): Promise<LlmResponse> {
        modelCalls += 1;
        return {
          toolCalls: [{ id: 'call-terminal', tool: 'commit_workflow_result', input: {} }],
        };
      },
    };
    const commitWorkflowResult: ToolDefinition = {
      name: 'commit_workflow_result',
      description: 'Commit the canonical workflow result.',
      returnDirect: true,
      parameters: { type: 'object', properties: {} },
      execute: async () => ({ ok: true, output: 'Workflow result committed.' }),
    };

    const run = AgentLoopRuntimeService.run({
      goal: 'Finish one workflow.',
      llm: fakeLlm,
      tools: [commitWorkflowResult],
      includeDefaultTools: false,
      maxSteps: 3,
      logger: silentLogger,
      onEvent: async (event) => {
        entered.push(event.type);
        if (event.type === 'tool.completed') {
          await toolCompletionPersisted;
        }
        completed.push(event.type);
      },
    });
    void run.then(() => {
      runSettled = true;
    });

    await vi.waitFor(() => expect(entered).toContain('tool.completed'));
    expect(entered).not.toContain('loop.finished');
    expect(runSettled).toBe(false);

    releaseToolCompletion();
    const result = await run;

    expect(result.outcome).toBe('done');
    expect(modelCalls).toBe(1);
    expect(completed.filter(
      (type) => type === 'tool.completed' || type === 'loop.finished',
    )).toEqual(['tool.completed', 'loop.finished']);
    expect(runSettled).toBe(true);
  });

  it('rejects the run when an async event listener fails', async () => {
    const projectionFailure = new Error('durable activity write failed');
    const fakeLlm: LlmAdapter = {
      info: {
        provider: 'openai',
        model: 'gpt-test',
        capabilities: {
          toolCalls: true,
          systemMessages: true,
          reasoningSummaries: false,
          parallelToolCalls: true,
        },
      },
      async chat(): Promise<LlmResponse> {
        return { content: 'Done.' };
      },
    };

    await expect(AgentLoopRuntimeService.run({
      goal: 'Complete one turn.',
      llm: fakeLlm,
      tools: [],
      includeDefaultTools: false,
      maxSteps: 1,
      logger: silentLogger,
      onEvent: (event) => event.type === 'loop.started'
        ? Promise.reject(projectionFailure)
        : Promise.resolve(),
    })).rejects.toBe(projectionFailure);
  });

  it('delivers synchronous start events before model execution', async () => {
    let observedStart = false;
    const fakeLlm: LlmAdapter = {
      info: {
        provider: 'openai',
        model: 'gpt-test',
        capabilities: {
          toolCalls: true,
          systemMessages: true,
          reasoningSummaries: false,
          parallelToolCalls: true,
        },
      },
      async chat(): Promise<LlmResponse> {
        expect(observedStart).toBe(true);
        return { content: 'Done.' };
      },
    };

    await AgentLoopRuntimeService.run({
      goal: 'Complete one turn.',
      llm: fakeLlm,
      tools: [],
      includeDefaultTools: false,
      maxSteps: 1,
      logger: silentLogger,
      onEvent: (event) => {
        if (event.type === 'loop.started') {
          observedStart = true;
        }
      },
    });
  });

  it('runs through the public execution loop and emits loop events around trace events', async () => {
    const workspaceRoot = resolve('/tmp/heddle-loop-test');
    const seenMessages: ChatMessage[][] = [];
    const events: AgentHeartbeatEvent[] = [];
    const fakeLlm: LlmAdapter = {
      info: {
        provider: 'openai',
        model: 'gpt-test',
        capabilities: {
          toolCalls: true,
          systemMessages: true,
          reasoningSummaries: false,
          parallelToolCalls: true,
        },
      },
      async chat(messages): Promise<LlmResponse> {
        seenMessages.push(messages);

        if (seenMessages.length === 1) {
          return {
            content: 'I will inspect first.',
            toolCalls: [{ id: 'call-1', tool: 'echo_tool', input: { value: 'repo' } }],
          };
        }

        return {
          content: 'Done.',
          usage: {
            inputTokens: 10,
            outputTokens: 2,
            totalTokens: 12,
            requests: 1,
          },
        };
      },
    };
    const echoTool: ToolDefinition = {
      name: 'echo_tool',
      description: 'Echoes a value.',
      parameters: { type: 'object', properties: { value: { type: 'string' } } },
      async execute(input) {
        return { ok: true, output: input };
      },
    };

    const result = await AgentLoopRuntimeService.run({
      goal: 'Use the echo tool.',
      llm: fakeLlm,
      tools: [echoTool],
      includeDefaultTools: false,
      maxSteps: 3,
      logger: silentLogger,
      workspaceRoot,
      onEvent: (event) => events.push(event),
    });

    expect(result.outcome).toBe('done');
    expect(result.summary).toBe('Done.');
    expect(result.model).toBe('gpt-test');
    expect(result.provider).toBe('openai');
    expect(result.state).toMatchObject({
      status: 'finished',
      goal: 'Use the echo tool.',
      model: 'gpt-test',
      provider: 'openai',
      workspaceRoot,
      outcome: 'done',
      summary: 'Done.',
    });
    expect(result.state.transcript).toEqual(result.transcript);
    expect(result.state.trace).toEqual(result.trace);
    expect(events[0]).toMatchObject({
      type: 'loop.started',
      goal: 'Use the echo tool.',
      model: 'gpt-test',
      provider: 'openai',
      workspaceRoot,
    });
    expect(events.some((event) => event.type === 'trace' && event.event.type === 'tool.calling')).toBe(true);
    expect(events.at(-1)).toMatchObject({
      type: 'loop.finished',
      outcome: 'done',
      summary: 'Done.',
    });
    expect(events.at(-1)).toMatchObject({
      type: 'loop.finished',
      state: {
        status: 'finished',
        outcome: 'done',
      },
    });
    expect(JSON.parse(JSON.stringify(result.state))).toMatchObject({
      status: 'finished',
      model: 'gpt-test',
      provider: 'openai',
    });
  });

  it('uses a validated host-preallocated run id in state and every runtime event', async () => {
    const events: AgentLoopEvent[] = [];
    const fakeLlm: LlmAdapter = {
      info: {
        provider: 'openai',
        model: 'gpt-test',
        capabilities: {
          toolCalls: true,
          systemMessages: true,
          reasoningSummaries: false,
          parallelToolCalls: true,
        },
      },
      async chat(): Promise<LlmResponse> {
        return { content: 'Done with the supplied identity.' };
      },
    };

    const result = await AgentLoopRuntimeService.run({
      runId: 'run_preallocated-test:1',
      goal: 'Use the supplied run id.',
      llm: fakeLlm,
      tools: [],
      includeDefaultTools: false,
      logger: silentLogger,
      onEvent: (event) => events.push(event),
    });

    expect(result.state.runId).toBe('run_preallocated-test:1');
    expect(events).not.toHaveLength(0);
    expect(events.every((event) => event.runId === 'run_preallocated-test:1')).toBe(true);
  });

  it('rejects invalid host-preallocated run ids before execution starts', async () => {
    const fakeLlm: LlmAdapter = {
      async chat(): Promise<LlmResponse> {
        return { content: 'This should not run.' };
      },
    };

    await expect(AgentLoopRuntimeService.run({
      runId: ' invalid/run ',
      goal: 'Reject the invalid run id.',
      llm: fakeLlm,
      tools: [],
      includeDefaultTools: false,
      logger: silentLogger,
    })).rejects.toThrow('runId must start with an alphanumeric character');
  });

  it('propagates safe model failures through loop state and terminal activity', async () => {
    const events: AgentLoopEvent[] = [];
    const fakeLlm: LlmAdapter = {
      info: {
        provider: 'openai',
        model: 'gpt-test',
        capabilities: {
          toolCalls: true,
          systemMessages: true,
          reasoningSummaries: false,
          parallelToolCalls: true,
        },
      },
      async chat(): Promise<LlmResponse> {
        throw Object.assign(new Error('Unauthorized'), { status: 401 });
      },
    };

    const result = await AgentLoopRuntimeService.run({
      goal: 'Use a rejected credential.',
      llm: fakeLlm,
      tools: [],
      includeDefaultTools: false,
      logger: silentLogger,
      workspaceRoot: resolve('/tmp/heddle-loop-failure-test'),
      onEvent: (event) => events.push(event),
    });

    expect(result.failure).toEqual({ source: 'model', code: 'authentication' });
    expect(result.state.failure).toEqual({ source: 'model', code: 'authentication' });
    expect(events.at(-1)).toMatchObject({
      type: 'loop.finished',
      failure: { source: 'model', code: 'authentication' },
      state: {
        failure: { source: 'model', code: 'authentication' },
      },
    });
  });

  it('preserves provider-private continuation through tool and final assistant turns', async () => {
    const seenMessages: ChatMessage[][] = [];
    const fakeLlm: LlmAdapter = {
      info: {
        provider: 'kimi',
        model: 'kimi/kimi-k3',
        capabilities: {
          toolCalls: true,
          systemMessages: true,
          reasoningSummaries: false,
          parallelToolCalls: false,
        },
      },
      async chat(messages): Promise<LlmResponse> {
        seenMessages.push(messages);
        return seenMessages.length === 1 ? {
          toolCalls: [{ id: 'call-1', tool: 'echo_tool', input: { value: 'repo' } }],
          providerContinuation: {
            provider: 'kimi',
            reasoningContent: 'Inspect before answering.',
          },
        } : {
          content: 'Done.',
          providerContinuation: {
            provider: 'kimi',
            reasoningContent: 'Answer from the result.',
          },
        };
      },
    };
    const echoTool: ToolDefinition = {
      name: 'echo_tool',
      description: 'Echoes a value.',
      parameters: { type: 'object', properties: { value: { type: 'string' } } },
      execute: async (input) => ({ ok: true, output: input }),
    };

    const result = await AgentLoopRuntimeService.run({
      goal: 'Use the echo tool.',
      llm: fakeLlm,
      tools: [echoTool],
      includeDefaultTools: false,
      maxSteps: 3,
      logger: silentLogger,
    });

    expect(seenMessages[1]).toContainEqual(expect.objectContaining({
      role: 'assistant',
      providerContinuation: {
        provider: 'kimi',
        reasoningContent: 'Inspect before answering.',
      },
    }));
    expect(result.transcript).toContainEqual({
      role: 'assistant',
      content: 'Done.',
      providerContinuation: {
        provider: 'kimi',
        reasoningContent: 'Answer from the result.',
      },
    });
  });

  it('propagates non-retryable quota failures through loop state and terminal activity', async () => {
    const events: AgentLoopEvent[] = [];
    const fakeLlm: LlmAdapter = {
      info: {
        provider: 'openai',
        model: 'gpt-test',
        capabilities: {
          toolCalls: true,
          systemMessages: true,
          reasoningSummaries: false,
          parallelToolCalls: true,
        },
      },
      async chat(): Promise<LlmResponse> {
        throw Object.assign(new Error('provider quota response'), { code: 'insufficient_quota' });
      },
    };

    const result = await AgentLoopRuntimeService.run({
      goal: 'Use a credential without quota.',
      llm: fakeLlm,
      tools: [],
      includeDefaultTools: false,
      logger: silentLogger,
      workspaceRoot: resolve('/tmp/heddle-loop-quota-failure-test'),
      onEvent: (event) => events.push(event),
    });

    expect(result.failure).toEqual({ source: 'model', code: 'quota' });
    expect(result.state.failure).toEqual({ source: 'model', code: 'quota' });
    expect(events.at(-1)).toMatchObject({
      type: 'loop.finished',
      failure: { source: 'model', code: 'quota' },
      state: {
        failure: { source: 'model', code: 'quota' },
      },
    });
  });

  it('emits assistant stream events through the programmatic event stream', async () => {
    const events: AgentHeartbeatEvent[] = [];
    const fakeLlm: LlmAdapter = {
      info: {
        provider: 'anthropic',
        model: 'claude-test',
        capabilities: {
          toolCalls: true,
          systemMessages: true,
          reasoningSummaries: false,
          parallelToolCalls: true,
        },
      },
      async chat(_messages, _tools, _signal, onStreamEvent): Promise<LlmResponse> {
        onStreamEvent?.({ type: 'content.delta', delta: 'Hel' });
        onStreamEvent?.({ type: 'content.done', content: 'Hello' });
        return { content: 'Hello' };
      },
    };

    await AgentLoopRuntimeService.run({
      goal: 'Say hello.',
      llm: fakeLlm,
      tools: [],
      includeDefaultTools: false,
      maxSteps: 1,
      logger: silentLogger,
      onEvent: (event) => events.push(event),
    });

    expect(events).toContainEqual(expect.objectContaining({
      type: 'assistant.stream',
      step: 1,
      text: 'Hello',
      done: true,
    }));
  });

  it('adds only activated Agent Skills catalog metadata to the runtime system context', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'heddle-loop-skills-'));
    const stateRoot = join(workspaceRoot, '.heddle');
    const seenMessages: ChatMessage[][] = [];
    const fakeLlm: LlmAdapter = {
      info: {
        provider: 'openai',
        model: 'gpt-test',
        capabilities: {
          toolCalls: true,
          systemMessages: true,
          reasoningSummaries: false,
          parallelToolCalls: true,
        },
      },
      async chat(messages): Promise<LlmResponse> {
        seenMessages.push(messages);
        return { content: 'Done.' };
      },
    };

    await mkdir(join(workspaceRoot, '.agents', 'skills', 'browser-research'), { recursive: true });
    await writeFile(
      join(workspaceRoot, '.agents', 'skills', 'browser-research', 'SKILL.md'),
      `---
name: browser-research
description: Research web pages through a browser.
---
# Browser Research

Use browser_snapshot before making claims.
`,
      'utf8',
    );
    await new AgentSkillService({
      workspaceRoot,
      activationStore: new FileAgentSkillActivationRepository({ stateRoot }),
    }).activateSkill('browser-research', new Date('2026-06-08T10:00:00.000Z'));

    await AgentLoopRuntimeService.run({
      goal: 'Use skills.',
      llm: fakeLlm,
      maxSteps: 1,
      logger: silentLogger,
      workspaceRoot,
      stateDir: '.heddle',
    });

    const systemMessage = seenMessages[0]?.find((message) => message.role === 'system')?.content ?? '';
    expect(systemMessage).toContain('<available_skills>');
    expect(systemMessage).toContain('browser-research');
    expect(systemMessage).toContain('Research web pages through a browser.');
    expect(systemMessage).toContain('read_agent_skill');
    expect(systemMessage).not.toContain('Use browser_snapshot before making claims.');
  });

  it('emits provider reasoning summaries through a distinct cumulative stream', async () => {
    const events: AgentLoopEvent[] = [];
    const fakeLlm: LlmAdapter = {
      info: {
        provider: 'openai',
        model: 'gpt-test',
        capabilities: {
          toolCalls: true,
          systemMessages: true,
          reasoningSummaries: true,
          parallelToolCalls: true,
        },
      },
      async chat(_messages, _tools, _signal, onStreamEvent): Promise<LlmResponse> {
        onStreamEvent?.({ type: 'reasoning_summary.delta', delta: '**Inspecting the request**' });
        onStreamEvent?.({ type: 'reasoning_summary.done', text: '**Inspecting the request** before choosing tools.' });
        return { content: 'Done.' };
      },
    };

    await AgentLoopRuntimeService.run({
      goal: 'Say hello.',
      llm: fakeLlm,
      tools: [],
      includeDefaultTools: false,
      maxSteps: 1,
      logger: silentLogger,
      onEvent: (event) => events.push(event),
    });

    const summaries = events.filter((event) => event.type === 'reasoning.summary');
    expect(summaries).toHaveLength(2);
    expect(summaries[0]).toMatchObject({
      step: 1,
      text: '**Inspecting the request**',
      done: false,
    });
    expect(summaries[1]).toMatchObject({
      step: 1,
      text: '**Inspecting the request** before choosing tools.',
      done: true,
    });
  });

  it('does not treat the workspace state directory as the OAuth credential store', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'heddle-loop-state-dir-'));
    await mkdir(join(workspaceRoot, '.heddle'));

    const fakeLlm: LlmAdapter = {
      info: {
        provider: 'openai',
        model: 'gpt-5.5',
        capabilities: {
          toolCalls: true,
          systemMessages: true,
          reasoningSummaries: false,
          parallelToolCalls: true,
        },
      },
      async chat(): Promise<LlmResponse> {
        return { content: 'Done.' };
      },
    };

    await expect(AgentLoopRuntimeService.run({
      goal: 'Use the fake LLM.',
      model: 'gpt-5.5',
      llm: fakeLlm,
      tools: [],
      includeDefaultTools: false,
      maxSteps: 1,
      logger: silentLogger,
      workspaceRoot,
      stateDir: '.heddle',
    })).resolves.toMatchObject({
      outcome: 'done',
      summary: 'Done.',
    });
  });

  it('can resume a later run from a prior serializable checkpoint', async () => {
    const seenMessages: ChatMessage[][] = [];
    const fakeLlm: LlmAdapter = {
      info: {
        provider: 'openai',
        model: 'gpt-test',
        capabilities: {
          toolCalls: true,
          systemMessages: true,
          reasoningSummaries: false,
          parallelToolCalls: true,
        },
      },
      async chat(messages): Promise<LlmResponse> {
        seenMessages.push(structuredClone(messages));
        return { content: `answer-${seenMessages.length}` };
      },
    };

    const first = await AgentLoopRuntimeService.run({
      goal: 'First turn.',
      llm: fakeLlm,
      tools: [],
      includeDefaultTools: false,
      maxSteps: 1,
      logger: silentLogger,
    });
    const checkpoint = AgentLoopCheckpointService.createCheckpoint(first.state, {
      createdAt: '2026-04-11T00:00:00.000Z',
    });

    expect(AgentLoopCheckpointService.historyFromState(first.state)).toEqual(first.transcript);
    expect(AgentLoopCheckpointService.historyFromCheckpoint(checkpoint)).toEqual(first.transcript);
    expect(JSON.parse(JSON.stringify(checkpoint))).toMatchObject({
      version: 1,
      state: {
        goal: 'First turn.',
        summary: 'answer-1',
      },
    });

    await AgentLoopRuntimeService.run({
      goal: 'Second turn.',
      llm: fakeLlm,
      tools: [],
      includeDefaultTools: false,
      resumeFrom: checkpoint,
      maxSteps: 1,
      logger: silentLogger,
    });

    expect(seenMessages[1]).toEqual(expect.arrayContaining([
      { role: 'user', content: 'First turn.' },
      { role: 'assistant', content: 'answer-1' },
      { role: 'user', content: 'Second turn.' },
    ]));
  });
});

describe('RuntimeToolService.createDefaultAgentTools', () => {
  it('creates the default runtime tool bundle with stable ordering and can omit planning for single-turn hosts', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'heddle-runtime-tools-'));
    const memoryDir = join(workspaceRoot, 'memory');
    const withPlan = RuntimeToolService.createDefaultAgentTools({
      model: 'gpt-test',
      workspaceRoot,
      memoryDir,
      includePlanTool: true,
    });
    const withoutPlan = RuntimeToolService.createDefaultAgentTools({
      model: 'gpt-test',
      workspaceRoot,
      memoryDir,
      includePlanTool: false,
    });

    expect(withPlan.map((tool) => tool.name)).toEqual([
      'read_agent_skill',
      'project_dashboard',
      'list_files',
      'read_file',
      'edit_file',
      'delete_file',
      'move_file',
      'search_files',
      'web_search',
      'view_image',
      'list_memory_notes',
      'read_memory_note',
      'search_memory_notes',
      'memory_checkpoint',
      'record_knowledge',
      'artifact_dashboard',
      'list_artifacts',
      'read_artifact',
      'save_artifact',
      'set_current_artifact',
      'update_plan',
      'run_shell_inspect',
      'run_shell_mutate',
    ]);
    expect(withoutPlan.map((tool) => tool.name)).toEqual([
      'read_agent_skill',
      'project_dashboard',
      'list_files',
      'read_file',
      'edit_file',
      'delete_file',
      'move_file',
      'search_files',
      'web_search',
      'view_image',
      'list_memory_notes',
      'read_memory_note',
      'search_memory_notes',
      'memory_checkpoint',
      'record_knowledge',
      'artifact_dashboard',
      'list_artifacts',
      'read_artifact',
      'save_artifact',
      'set_current_artifact',
      'run_shell_inspect',
      'run_shell_mutate',
    ]);
    expect(withoutPlan.map((tool) => tool.name)).not.toContain('edit_memory_note');
  });

  it('supports explicit memory tool modes', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'heddle-runtime-tools-'));
    const memoryDir = join(workspaceRoot, 'memory');
    const none = RuntimeToolService.createDefaultAgentTools({
      model: 'gpt-test',
      workspaceRoot,
      memoryDir,
      memoryMode: 'none',
    }).map((tool) => tool.name);
    const readOnly = RuntimeToolService.createDefaultAgentTools({
      model: 'gpt-test',
      workspaceRoot,
      memoryDir,
      memoryMode: 'read-only',
    }).map((tool) => tool.name);
    const maintainer = RuntimeToolService.createDefaultAgentTools({
      model: 'gpt-test',
      workspaceRoot,
      memoryDir,
      memoryMode: 'maintainer',
    }).map((tool) => tool.name);
    const legacy = RuntimeToolService.createDefaultAgentTools({
      model: 'gpt-test',
      workspaceRoot,
      memoryDir,
      memoryMode: 'legacy-full',
    }).map((tool) => tool.name);

    expect(none).not.toContain('list_memory_notes');
    expect(none).not.toContain('record_knowledge');
    expect(readOnly).toEqual(expect.arrayContaining([
      'list_memory_notes',
      'read_memory_note',
      'search_memory_notes',
    ]));
    expect(readOnly).not.toContain('memory_checkpoint');
    expect(readOnly).not.toContain('record_knowledge');
    expect(readOnly).not.toContain('edit_memory_note');
    expect(maintainer).toEqual(expect.arrayContaining([
      'list_memory_notes',
      'read_memory_note',
      'search_memory_notes',
      'edit_memory_note',
    ]));
    expect(maintainer).not.toContain('record_knowledge');
    expect(legacy).toContain('edit_memory_note');
  });
});

describe('ToolBundleComposer', () => {
  const context = {
    workspaceRoot: '/tmp/workspace',
    stateRoot: '/tmp/workspace/.heddle',
    model: 'gpt-test',
    memoryDir: '/tmp/memory',
    memoryMode: 'none' as const,
  };

  it('rejects duplicate toolkit ids', () => {
    const duplicateToolkit: ToolToolkit = {
      id: 'duplicate',
      createTools: () => [],
    };

    expect(() => ToolBundleComposer.compose({
      toolkits: [duplicateToolkit, duplicateToolkit],
      context,
    })).toThrow('Duplicate toolkit id: duplicate');
  });

  it('rejects duplicate tool names across toolkits', () => {
    const first: ToolToolkit = {
      id: 'first',
      createTools: () => [{ name: 'shared_tool', description: 'a', parameters: {}, execute: async () => ({ ok: true, output: 'a' }) }],
    };
    const second: ToolToolkit = {
      id: 'second',
      createTools: () => [{ name: 'shared_tool', description: 'b', parameters: {}, execute: async () => ({ ok: true, output: 'b' }) }],
    };

    expect(() => ToolBundleComposer.compose({
      toolkits: [first, second],
      context,
    })).toThrow('Duplicate tool name from toolkits: shared_tool');
  });
});

describe('HeartbeatRunnerAgent.run', () => {
  it('composes exactly the read-only memory toolkit for an isolated heartbeat run', async () => {
    const root = await mkdtemp(join(tmpdir(), 'heddle-heartbeat-read-only-memory-'));
    let modelVisibleTools: string[] = [];
    const fakeLlm: LlmAdapter = {
      info: {
        provider: 'openai',
        model: 'gpt-test',
        capabilities: {
          toolCalls: true,
          systemMessages: true,
          reasoningSummaries: false,
          parallelToolCalls: true,
        },
      },
      async chat(_messages, tools): Promise<LlmResponse> {
        modelVisibleTools = tools.map((tool) => tool.name);
        return {
          content: 'Read-only inspection is complete.\n\nHEARTBEAT_DECISION: continue',
        };
      },
    };

    const result = await HeartbeatRunnerAgent.run({
      task: 'Inspect durable memory without changing it.',
      llm: fakeLlm,
      apiKey: 'test-api-key',
      apiKeyProvider: 'explicit',
      preferApiKey: true,
      toolkits: [memoryToolkit],
      includeDefaultTools: false,
      memoryMode: 'read-only',
      memoryDir: join(root, 'memory'),
      workspaceRoot: root,
      maxSteps: 1,
      logger: silentLogger,
    });

    expect(modelVisibleTools).toEqual([
      'list_memory_notes',
      'read_memory_note',
      'search_memory_notes',
    ]);
    expect(result.memory).toEqual({ changed: false });
  });

  it('reports a settled memory change after a heartbeat records knowledge', async () => {
    const root = await mkdtemp(join(tmpdir(), 'heddle-heartbeat-memory-change-'));
    let modelCalls = 0;
    const fakeLlm: LlmAdapter = {
      info: {
        provider: 'openai',
        model: 'gpt-test',
        capabilities: {
          toolCalls: true,
          systemMessages: true,
          reasoningSummaries: false,
          parallelToolCalls: true,
        },
      },
      async chat(): Promise<LlmResponse> {
        modelCalls += 1;
        if (modelCalls === 1) {
          return {
            toolCalls: [{
              id: 'record-1',
              tool: 'record_knowledge',
              input: { summary: 'Use the focused heartbeat verification command for this repository.' },
            }],
          };
        }
        return {
          content: 'The durable observation was recorded.\n\nHEARTBEAT_DECISION: continue',
        };
      },
    };

    const result = await HeartbeatRunnerAgent.run({
      task: 'Capture one durable heartbeat observation.',
      llm: fakeLlm,
      apiKey: 'test-api-key',
      apiKeyProvider: 'explicit',
      preferApiKey: true,
      toolkits: [memoryToolkit],
      includeDefaultTools: false,
      memoryMode: 'read-and-record',
      memoryDir: join(root, 'memory'),
      workspaceRoot: root,
      maxSteps: 2,
      logger: silentLogger,
    });

    expect(result.memory).toEqual({ changed: true });
  });

  it('runs an autonomous runner cycle and returns a checkpoint with the parsed decision', async () => {
    const seenMessages: ChatMessage[][] = [];
    const fakeLlm: LlmAdapter = {
      info: {
        provider: 'openai',
        model: 'gpt-test',
        capabilities: {
          toolCalls: true,
          systemMessages: true,
          reasoningSummaries: false,
          parallelToolCalls: true,
        },
      },
      async chat(messages): Promise<LlmResponse> {
        seenMessages.push(structuredClone(messages));
        return {
          content: 'Checked durable task state and found no immediate blocker.\n\nHEARTBEAT_DECISION: continue',
        };
      },
    };

    const result = await HeartbeatRunnerAgent.run({
      task: 'Keep watching for useful project maintenance work.',
      llm: fakeLlm,
      tools: [],
      includeDefaultTools: false,
      maxSteps: 1,
      logger: silentLogger,
    });

    expect(result.decision).toBe('continue');
    expect(result.memory).toEqual({ changed: false });
    expect(result.checkpoint.version).toBe(1);
    expect(result.state.goal).toContain('# Heartbeat Run');
    expect(seenMessages[0][0]).toMatchObject({
      role: 'system',
    });
    expect(seenMessages[0][0].content).toContain('Heartbeat Mode');
    expect(seenMessages[0].at(-1)).toMatchObject({
      role: 'user',
      content: expect.stringContaining('## Durable Task'),
    });
  });

  it('uses the exact host-owned prompt and durable task without heartbeat wrappers', async () => {
    const seenMessages: ChatMessage[][] = [];
    const systemPrompt = 'You are the standing product agent.\n\nFollow the durable charter.\n';
    const task = 'Review the owner inbox.\n\nDraft one useful update.\n';
    const fakeLlm: LlmAdapter = {
      info: {
        provider: 'openai',
        model: 'gpt-test',
        capabilities: {
          toolCalls: true,
          systemMessages: true,
          reasoningSummaries: false,
          parallelToolCalls: true,
        },
      },
      async chat(messages): Promise<LlmResponse> {
        seenMessages.push(structuredClone(messages));
        return { content: 'Completed the bounded review.' };
      },
    };

    const result = await HeartbeatRunnerAgent.run({
      task,
      systemContext: 'THIS_HEARTBEAT_APPENDIX_MUST_NOT_BE_VISIBLE',
      promptComposition: { mode: 'host-owned', systemPrompt },
      runContext: {
        currentDateTime: '2026-09-14T00:00:00.000Z',
        intervalMs: 60_000,
        continuationMode: 'operator',
      },
      llm: fakeLlm,
      tools: [],
      includeDefaultTools: false,
      maxSteps: 1,
      logger: silentLogger,
    });

    expect(seenMessages[0]).toEqual([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: task },
    ]);
    expect(result.state.goal).toBe(task);
    expect(result.decision).toBe('pause');
    expect(result.memory).toEqual({ changed: false });
  });

  it('resumes a heartbeat from a prior checkpoint', async () => {
    const seenMessages: ChatMessage[][] = [];
    const fakeLlm: LlmAdapter = {
      info: {
        provider: 'openai',
        model: 'gpt-test',
        capabilities: {
          toolCalls: true,
          systemMessages: true,
          reasoningSummaries: false,
          parallelToolCalls: true,
        },
      },
      async chat(messages): Promise<LlmResponse> {
        seenMessages.push(structuredClone(messages));
        return {
          content: `heartbeat-${seenMessages.length}\n\nHEARTBEAT_DECISION: pause`,
        };
      },
    };

    const first = await HeartbeatRunnerAgent.run({
      task: 'Maintain background task.',
      llm: fakeLlm,
      tools: [],
      includeDefaultTools: false,
      maxSteps: 1,
      logger: silentLogger,
    });

    await HeartbeatRunnerAgent.run({
      task: 'Maintain background task.',
      checkpoint: first.checkpoint,
      llm: fakeLlm,
      tools: [],
      includeDefaultTools: false,
      maxSteps: 1,
      logger: silentLogger,
    });

    expect(seenMessages[1]).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'assistant', content: expect.stringContaining('heartbeat-1') }),
      expect.objectContaining({ role: 'user', content: expect.stringContaining('# Heartbeat Run') }),
    ]));
  });
});

describe('StoredHeartbeatService.run', () => {
  it('loads, saves, and returns scheduling hints for checkpoint-backed runner cycles', async () => {
    let stored: unknown;
    const store: HeartbeatCheckpointStore = {
      async load() {
        return stored as never;
      },
      async save(checkpoint) {
        stored = checkpoint;
      },
    };
    const fakeLlm: LlmAdapter = {
      info: {
        provider: 'openai',
        model: 'gpt-test',
        capabilities: {
          toolCalls: true,
          systemMessages: true,
          reasoningSummaries: false,
          parallelToolCalls: true,
        },
      },
      async chat(): Promise<LlmResponse> {
        return {
          content: 'There is more autonomous work to do.\n\nHEARTBEAT_DECISION: continue',
        };
      },
    };

    const result = await StoredHeartbeatService.run({
      task: 'Maintain background work.',
      store,
      llm: fakeLlm,
      tools: [],
      includeDefaultTools: false,
      maxSteps: 1,
      logger: silentLogger,
    });

    expect(result.loadedCheckpoint).toBe(false);
    expect(result.decision).toBe('continue');
    expect(result.nextDelayMs).toBe(60_000);
    expect(stored).toMatchObject({
      version: 1,
      state: {
        outcome: 'done',
      },
    });
  });

  it('maps terminal heartbeat decisions to no scheduling hint', () => {
    expect(HeartbeatDecisionPolicy.suggestNextDelayMs('complete')).toBeUndefined();
    expect(HeartbeatDecisionPolicy.suggestNextDelayMs('escalate')).toBeUndefined();
    expect(HeartbeatDecisionPolicy.suggestNextDelayMs('pause')).toBe(15 * 60_000);
  });
});

describe('AgentLoopEvent contracts', () => {
  it('emits tool.calling and tool.completed events with stable payloads', async () => {
    const events: AgentLoopEvent[] = [];
    const fakeLlm: LlmAdapter = {
      info: {
        provider: 'openai',
        model: 'gpt-test',
        capabilities: {
          toolCalls: true,
          systemMessages: true,
          reasoningSummaries: false,
          parallelToolCalls: true,
        },
      },
      async chat(): Promise<LlmResponse> {
        return {
          content: 'Using echo.',
          toolCalls: [{ id: 'call-1', tool: 'echo_tool', input: { value: 'test' } }],
        };
      },
    };
    const echoTool: ToolDefinition = {
      name: 'echo_tool',
      description: 'Echoes a value.',
      requiresApproval: false,
      parameters: { type: 'object', properties: { value: { type: 'string' } } },
      async execute(input) {
        return { ok: true, output: input };
      },
    };

    await AgentLoopRuntimeService.run({
      goal: 'Test tool events.',
      llm: fakeLlm,
      tools: [echoTool],
      includeDefaultTools: false,
      maxSteps: 1,
      logger: silentLogger,
      onEvent: (event) => events.push(event),
    });

    const callingEvent = events.find((e) => e.type === 'tool.calling');
    const completedEvent = events.find((e) => e.type === 'tool.completed');

    expect(callingEvent).toMatchObject({
      type: 'tool.calling',
      runId: expect.stringMatching(/^run_/),
      step: 1,
      tool: 'echo_tool',
      toolCallId: 'call-1',
      input: { value: 'test' },
      requiresApproval: false,
      timestamp: expect.any(String),
    });

    expect(completedEvent).toMatchObject({
      type: 'tool.completed',
      runId: expect.stringMatching(/^run_/),
      step: 1,
      tool: 'echo_tool',
      toolCallId: 'call-1',
      result: { ok: true, output: { value: 'test' } },
      durationMs: expect.any(Number),
      timestamp: expect.any(String),
    });

    // Verify runId correlation across events
    expect(callingEvent?.runId).toBe(completedEvent?.runId);
  });

  it('emits loop.resumed event when resuming from checkpoint', async () => {
    const events: AgentLoopEvent[] = [];
    const fakeLlm: LlmAdapter = {
      info: {
        provider: 'openai',
        model: 'gpt-test',
        capabilities: {
          toolCalls: true,
          systemMessages: true,
          reasoningSummaries: false,
          parallelToolCalls: true,
        },
      },
      async chat(): Promise<LlmResponse> {
        return { content: 'Done.' };
      },
    };

    const first = await AgentLoopRuntimeService.run({
      goal: 'First.',
      llm: fakeLlm,
      tools: [],
      includeDefaultTools: false,
      maxSteps: 1,
      logger: silentLogger,
    });

    const checkpoint = AgentLoopCheckpointService.createCheckpoint(first.state);

    await AgentLoopRuntimeService.run({
      goal: 'Second.',
      llm: fakeLlm,
      tools: [],
      includeDefaultTools: false,
      resumeFrom: checkpoint,
      maxSteps: 1,
      logger: silentLogger,
      onEvent: (event) => events.push(event),
    });

    const resumedEvent = events.find((e) => e.type === 'loop.resumed');
    const startedEvent = events.find((e) => e.type === 'loop.started');

    expect(resumedEvent).toMatchObject({
      type: 'loop.resumed',
      runId: expect.stringMatching(/^run_/),
      fromCheckpoint: first.state.runId,
      priorTraceEvents: expect.any(Number),
      timestamp: expect.any(String),
    });

    expect(startedEvent).toMatchObject({
      type: 'loop.started',
      runId: resumedEvent?.runId,
      resumedFromCheckpoint: first.state.runId,
    });
  });

  it('emits heartbeat.decision and checkpoint.saved events', async () => {
    const events: AgentLoopEvent[] = [];
    const fakeLlm: LlmAdapter = {
      info: {
        provider: 'openai',
        model: 'gpt-test',
        capabilities: {
          toolCalls: true,
          systemMessages: true,
          reasoningSummaries: false,
          parallelToolCalls: true,
        },
      },
      async chat(): Promise<LlmResponse> {
        return {
          content: 'Task is progressing well.\n\nHEARTBEAT_DECISION: continue',
        };
      },
    };

    await HeartbeatRunnerAgent.run({
      task: 'Background work.',
      llm: fakeLlm,
      tools: [],
      includeDefaultTools: false,
      maxSteps: 1,
      logger: silentLogger,
      onEvent: (event) => events.push(event),
    });

    const decisionEvent = events.find((e) => e.type === 'heartbeat.decision');
    const checkpointEvent = events.find((e) => e.type === 'checkpoint.saved');

    expect(decisionEvent).toMatchObject({
      type: 'heartbeat.decision',
      runId: expect.stringMatching(/^run_/),
      decision: 'continue',
      outcome: 'done',
      summary: expect.stringContaining('HEARTBEAT_DECISION: continue'),
      timestamp: expect.any(String),
    });

    expect(checkpointEvent).toMatchObject({
      type: 'checkpoint.saved',
      runId: decisionEvent?.runId,
      checkpoint: {
        runId: expect.stringMatching(/^run_/),
        version: 1,
      },
      step: expect.any(Number),
      timestamp: expect.any(String),
    });
  });

  it('emits escalation.required event when heartbeat decides to escalate', async () => {
    const events: AgentLoopEvent[] = [];
    const fakeLlm: LlmAdapter = {
      info: {
        provider: 'openai',
        model: 'gpt-test',
        capabilities: {
          toolCalls: true,
          systemMessages: true,
          reasoningSummaries: false,
          parallelToolCalls: true,
        },
      },
      async chat(): Promise<LlmResponse> {
        return {
          content: 'Blocked by policy.\n\nHEARTBEAT_DECISION: escalate',
        };
      },
    };

    await HeartbeatRunnerAgent.run({
      task: 'Risky work.',
      llm: fakeLlm,
      tools: [],
      includeDefaultTools: false,
      maxSteps: 1,
      logger: silentLogger,
      onEvent: (event) => events.push(event),
    });

    const decisionEvent = events.find((e) => e.type === 'heartbeat.decision');

    expect(decisionEvent?.decision).toBe('escalate');

    const escalationEvent = events.find((e) => e.type === 'escalation.required');

    expect(escalationEvent).toMatchObject({
      type: 'escalation.required',
      runId: decisionEvent?.runId,
      task: 'Risky work.',
      outcome: 'done',
      summary: expect.stringContaining('HEARTBEAT_DECISION: escalate'),
      step: expect.any(Number),
      timestamp: expect.any(String),
    });
  });

  it('includes runId in all loop-level events for correlation', async () => {
    const events: AgentLoopEvent[] = [];
    const fakeLlm: LlmAdapter = {
      info: {
        provider: 'openai',
        model: 'gpt-test',
        capabilities: {
          toolCalls: true,
          systemMessages: true,
          reasoningSummaries: false,
          parallelToolCalls: true,
        },
      },
      async chat(): Promise<LlmResponse> {
        return { content: 'Done.' };
      },
    };

    await AgentLoopRuntimeService.run({
      goal: 'Test correlation.',
      llm: fakeLlm,
      tools: [],
      includeDefaultTools: false,
      maxSteps: 1,
      logger: silentLogger,
      onEvent: (event) => events.push(event),
    });

    const loopEvents = events.filter(
      (e) => e.type === 'loop.started' || e.type === 'loop.finished' || e.type === 'assistant.stream' || e.type === 'trace'
    );

    expect(loopEvents.length).toBeGreaterThan(0);

    const runId = loopEvents[0]?.runId;
    expect(runId).toMatch(/^run_/);

    for (const event of loopEvents) {
      expect(event.runId).toBe(runId);
    }
  });
});
