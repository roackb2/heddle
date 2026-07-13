import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AgentLoopCheckpointService, AgentLoopRuntimeService } from '@/core/runtime/loop/index.js';
import { RuntimeToolService } from '@/core/runtime/tools/index.js';
import { ToolBundleComposer, type ToolToolkit } from '@/core/tools/index.js';
import { AgentSkillService, FileAgentSkillActivationRepository } from '@/core/skills/index.js';
import type { ChatMessage, LlmAdapter, LlmResponse } from '../../../core/llm/types.js';
import type { AgentHeartbeatEvent, AgentLoopEvent, ToolDefinition } from '../../../advanced.js';
import { createLogger } from '../../../core/utils/logger.js';
import {
  HeartbeatDecisionPolicy,
  HeartbeatRunnerAgent,
  StoredHeartbeatService,
  type HeartbeatCheckpointStore,
} from '@/core/heartbeat/index.js';

const silentLogger = createLogger({ level: 'silent', console: false });

describe('AgentLoopRuntimeService.run', () => {
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

  it('emits streamed reasoning summaries as assistant progress events', async () => {
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

    expect(events).toContainEqual(expect.objectContaining({
      type: 'assistant.stream',
      step: 1,
      text: 'Thinking: Inspecting the request before choosing tools.',
      done: false,
    }));
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
