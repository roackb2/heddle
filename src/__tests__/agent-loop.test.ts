import { describe, expect, it } from 'vitest';
import { runAgentLoop } from '../runtime/agent-loop.js';
import { createAgentLoopCheckpoint, getHistoryFromAgentLoopCheckpoint, getHistoryFromAgentLoopState } from '../runtime/events.js';
import { createDefaultAgentTools } from '../runtime/default-tools.js';
import type { ChatMessage, LlmAdapter, LlmResponse } from '../llm/types.js';
import type { AgentLoopEvent, ToolDefinition } from '../index.js';
import { createLogger } from '../utils/logger.js';
import { runAgentHeartbeat } from '../runtime/heartbeat.js';
import { runStoredHeartbeat, suggestNextHeartbeatDelayMs, type HeartbeatCheckpointStore } from '../runtime/heartbeat-store.js';

const silentLogger = createLogger({ level: 'silent', console: false });

describe('runAgentLoop', () => {
  it('runs through the public execution loop and emits loop events around trace events', async () => {
    const seenMessages: ChatMessage[][] = [];
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

    const result = await runAgentLoop({
      goal: 'Use the echo tool.',
      llm: fakeLlm,
      tools: [echoTool],
      includeDefaultTools: false,
      maxSteps: 3,
      logger: silentLogger,
      workspaceRoot: '/tmp/heddle-loop-test',
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
      workspaceRoot: '/tmp/heddle-loop-test',
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
      workspaceRoot: '/tmp/heddle-loop-test',
    });
    expect(events.some((event) => event.type === 'trace' && event.event.type === 'tool.call')).toBe(true);
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

  it('emits assistant stream events through the programmatic event stream', async () => {
    const events: AgentLoopEvent[] = [];
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

    await runAgentLoop({
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

    const first = await runAgentLoop({
      goal: 'First turn.',
      llm: fakeLlm,
      tools: [],
      includeDefaultTools: false,
      maxSteps: 1,
      logger: silentLogger,
    });
    const checkpoint = createAgentLoopCheckpoint(first.state, {
      createdAt: '2026-04-11T00:00:00.000Z',
    });

    expect(getHistoryFromAgentLoopState(first.state)).toEqual(first.transcript);
    expect(getHistoryFromAgentLoopCheckpoint(checkpoint)).toEqual(first.transcript);
    expect(JSON.parse(JSON.stringify(checkpoint))).toMatchObject({
      version: 1,
      state: {
        goal: 'First turn.',
        summary: 'answer-1',
      },
    });

    await runAgentLoop({
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

describe('createDefaultAgentTools', () => {
  it('creates the default runtime tool bundle and can omit planning for single-turn hosts', () => {
    const withPlan = createDefaultAgentTools({
      model: 'gpt-test',
      memoryDir: '/tmp/heddle-memory',
      includePlanTool: true,
    });
    const withoutPlan = createDefaultAgentTools({
      model: 'gpt-test',
      memoryDir: '/tmp/heddle-memory',
      includePlanTool: false,
    });

    expect(withPlan.map((tool) => tool.name)).toContain('update_plan');
    expect(withoutPlan.map((tool) => tool.name)).not.toContain('update_plan');
    expect(withoutPlan.map((tool) => tool.name)).toEqual(expect.arrayContaining([
      'list_files',
      'read_file',
      'edit_file',
      'web_search',
      'view_image',
      'list_memory_notes',
      'read_memory_note',
      'search_memory_notes',
      'edit_memory_note',
      'run_shell_inspect',
      'run_shell_mutate',
    ]));
  });
});

describe('runAgentHeartbeat', () => {
  it('runs an autonomous wake cycle and returns a checkpoint with the parsed decision', async () => {
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

    const result = await runAgentHeartbeat({
      task: 'Keep watching for useful project maintenance work.',
      llm: fakeLlm,
      tools: [],
      includeDefaultTools: false,
      maxSteps: 1,
      logger: silentLogger,
    });

    expect(result.decision).toBe('continue');
    expect(result.checkpoint.version).toBe(1);
    expect(result.state.goal).toContain('Heartbeat wake cycle.');
    expect(seenMessages[0][0]).toMatchObject({
      role: 'system',
    });
    expect(seenMessages[0][0].content).toContain('Heartbeat Mode');
    expect(seenMessages[0].at(-1)).toMatchObject({
      role: 'user',
      content: expect.stringContaining('Durable task:'),
    });
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

    const first = await runAgentHeartbeat({
      task: 'Maintain background task.',
      llm: fakeLlm,
      tools: [],
      includeDefaultTools: false,
      maxSteps: 1,
      logger: silentLogger,
    });

    await runAgentHeartbeat({
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
      expect.objectContaining({ role: 'user', content: expect.stringContaining('Heartbeat wake cycle.') }),
    ]));
  });
});

describe('runStoredHeartbeat', () => {
  it('loads, saves, and returns scheduling hints for checkpoint-backed wake cycles', async () => {
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

    const result = await runStoredHeartbeat({
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
    expect(suggestNextHeartbeatDelayMs('complete')).toBeUndefined();
    expect(suggestNextHeartbeatDelayMs('escalate')).toBeUndefined();
    expect(suggestNextHeartbeatDelayMs('pause')).toBe(15 * 60_000);
  });
});
