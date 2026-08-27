import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  AgentLoopRuntimeService,
  DelegationService,
  type ChatMessage,
  type ConversationActivity,
  type DelegateTaskOutput,
  type DelegatedRunRecord,
  type LlmAdapter,
  type LlmResponse,
  type ToolDefinition,
} from '../../../advanced.js';
import { createLogger } from '../../../core/utils/logger.js';
import { RuntimeToolProfileService } from '../../../core/runtime/tools/index.js';

const silentLogger = createLogger({ level: 'silent', console: false });

describe('headless read-only delegation', () => {
  it('runs two parallel children through the existing runtime and lets the root synthesize', async () => {
    const fixture = await runFixture(true);

    expect(fixture.rootResult).toMatchObject({
      outcome: 'done',
      summary: 'Synthesized module and test findings.',
      state: { runId: 'run_root-two-child-fixture' },
    });
    expect(fixture.peakActiveChildren).toBe(2);
    expect(fixture.childAdapters.size).toBe(2);
    expect(fixture.childFactoryInputs).toHaveLength(2);
    expect(fixture.rootToolOutputs.map((output) => output.summary)).toEqual([
      'Module inspection found the runtime boundary.',
      'Test review found complete negative coverage.',
    ]);
    expect(fixture.rootToolOutputs.every((output) => (
      !('trace' in output) && !('transcript' in output) && !('usage' in output)
    ))).toBe(true);
    expect(fixture.records).toHaveLength(2);
    const lifecycle = fixture.activities.filter(({ source }) => source === 'delegation');
    expect(lifecycle.filter(({ type }) => type === 'delegation.started')).toHaveLength(2);
    expect(lifecycle.filter(({ type }) => type === 'delegation.finished')).toHaveLength(2);
    expect(lifecycle.some(({ type }) => type === 'delegation.child.activity')).toBe(true);
    expect(lifecycle.some((activity) => (
      activity.type === 'delegation.child.activity'
      && activity.activity.type === 'assistant.stream'
    ))).toBe(false);
    expect(lifecycle.every((activity) => (
      activity.type === 'delegation.rejected'
      || (
        activity.rootRunId === fixture.rootResult.state.runId
        && activity.parentRunId === fixture.rootResult.state.runId
        && activity.depth === 1
        && typeof activity.delegationId === 'string'
        && typeof activity.childRunId === 'string'
      )
    ))).toBe(true);
    expect(fixture.records.every((record) => (
      record.rootRunId === fixture.rootResult.state.runId
      && record.parentRunId === fixture.rootResult.state.runId
      && record.depth === 1
      && record.status === 'finished'
      && record.outcome === 'done'
      && record.model === 'gpt-test'
      && record.provider === 'openai'
      && record.trace.length > 0
      && record.usage?.requests === 1
    ))).toBe(true);
    expect(fixture.childMessages.every((messages) => {
      const serialized = JSON.stringify(messages);
      return serialized.includes('BASE_PROJECT_CONTEXT')
        && serialized.includes('Selected Agent Profile')
        && !serialized.includes('ROOT_PROFILE_SENTINEL')
        && !serialized.includes('PARENT_HISTORY_SENTINEL');
    })).toBe(true);
    expect(fixture.childTools.every((tools) => (
      !tools.some((tool) => tool.name === 'delegate_task')
      && !tools.some((tool) => tool.name === 'run_shell_inspect')
      && !tools.some((tool) => tool.name === 'read_agent_skill')
      && tools.every((tool) => RuntimeToolProfileService.capabilitiesFor(tool).every(
        (capability) => capability === 'workspace.read',
      ))
    ))).toBe(true);
  });

  it('preserves result order and executes serially when the root adapter lacks parallel-tool support', async () => {
    const fixture = await runFixture(false);

    expect(fixture.rootResult.outcome).toBe('done');
    expect(fixture.peakActiveChildren).toBe(1);
    expect(fixture.rootToolOutputs.map((output) => output.summary)).toEqual([
      'Module inspection found the runtime boundary.',
      'Test review found complete negative coverage.',
    ]);
    expect(fixture.records.map((record) => record.task)).toEqual([
      'Inspect the module boundary.',
      'Review the test coverage.',
    ]);
  });

  it('lets a delegated child exceed the generic 30-second tool timeout', async () => {
    vi.useFakeTimers();
    try {
      const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-long-delegation-integration-'));
      let markChildStarted!: () => void;
      const childStarted = new Promise<void>((resolveStarted) => {
        markChildStarted = resolveStarted;
      });
      const scope = new DelegationService({
        policy: {
          enabled: true,
          maxChildren: 1,
          maxConcurrentChildren: 1,
          maxStepsPerChild: 2,
          allowedAgentProfileIds: ['builtin:ask'],
        },
      }).createRootScope({
        rootRunId: 'run_long-child-fixture',
        workspaceRoot,
        runtime: {
          model: 'gpt-test',
          logger: silentLogger,
          createChildLlm: () => childAdapter({
            task: 'Inspect slow-child',
            onStart: markChildStarted,
            onFinish: () => undefined,
            onRequest: () => undefined,
            delayMs: 30_001,
          }),
        },
      });
      let rootRequest = 0;
      const rootAdapter: LlmAdapter = {
        info: {
          provider: 'openai',
          model: 'gpt-test',
          capabilities: {
            toolCalls: true,
            systemMessages: true,
            reasoningSummaries: false,
            parallelToolCalls: false,
          },
        },
        async chat(): Promise<LlmResponse> {
          rootRequest += 1;
          return rootRequest === 1
            ? {
              toolCalls: [{
                id: 'delegate-slow-child',
                tool: 'delegate_task',
                input: { task: 'Inspect slow-child', agentProfileId: 'builtin:ask' },
              }],
            }
            : { content: 'Synthesized slow child result.' };
        },
      };

      const running = AgentLoopRuntimeService.run({
        runId: scope.rootRunId,
        goal: 'Delegate one deliberately slow inspection.',
        model: 'gpt-test',
        llm: rootAdapter,
        tools: [scope.createTool()],
        includeDefaultTools: false,
        maxSteps: 3,
        workspaceRoot,
        logger: silentLogger,
      });

      await childStarted;
      await vi.advanceTimersByTimeAsync(30_001);
      const result = await running;

      expect(result).toMatchObject({
        outcome: 'done',
        summary: 'Synthesized slow child result.',
      });
      expect(scope.records()).toMatchObject([{
        status: 'finished',
        outcome: 'done',
        summary: 'Module inspection found the runtime boundary.',
      }]);
    } finally {
      vi.useRealTimers();
    }
  });
});

async function runFixture(rootSupportsParallel: boolean): Promise<{
  rootResult: Awaited<ReturnType<typeof AgentLoopRuntimeService.run>>;
  records: DelegatedRunRecord[];
  rootToolOutputs: DelegateTaskOutput[];
  childMessages: ChatMessage[][];
  childTools: ToolDefinition[][];
  childFactoryInputs: Array<{ childRunId: string; delegationId: string; task: string }>;
  childAdapters: Set<LlmAdapter>;
  peakActiveChildren: number;
  activities: ConversationActivity[];
}> {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-delegation-integration-'));
  const childMessages: ChatMessage[][] = [];
  const childTools: ToolDefinition[][] = [];
  const childFactoryInputs: Array<{ childRunId: string; delegationId: string; task: string }> = [];
  const childAdapters = new Set<LlmAdapter>();
  const rootToolOutputs: DelegateTaskOutput[] = [];
  const activities: ConversationActivity[] = [];
  let activeChildren = 0;
  let peakActiveChildren = 0;
  let rootRequest = 0;

  const delegation = new DelegationService({
    policy: {
      enabled: true,
      maxChildren: 4,
      maxConcurrentChildren: 3,
      maxStepsPerChild: 24,
    },
  });
  const scope = delegation.createRootScope({
    rootRunId: 'run_root-two-child-fixture',
    workspaceRoot,
    onActivity: (activity) => activities.push(structuredClone(activity)),
    runtime: {
      model: 'gpt-test',
      baseSystemContext: 'BASE_PROJECT_CONTEXT',
      logger: silentLogger,
      createChildLlm: (input) => {
        childFactoryInputs.push({
          childRunId: input.childRunId,
          delegationId: input.delegationId,
          task: input.task,
        });
        const adapter = childAdapter({
          task: input.task,
          onStart: () => {
            activeChildren += 1;
            peakActiveChildren = Math.max(peakActiveChildren, activeChildren);
          },
          onFinish: () => {
            activeChildren -= 1;
          },
          onRequest: (messages, tools) => {
            childMessages.push(messages);
            childTools.push(tools);
          },
        });
        childAdapters.add(adapter);
        return adapter;
      },
    },
  });
  const rootAdapter: LlmAdapter = {
    info: {
      provider: 'openai',
      model: 'gpt-test',
      capabilities: {
        toolCalls: true,
        systemMessages: true,
        reasoningSummaries: false,
        parallelToolCalls: rootSupportsParallel,
      },
    },
    async chat(messages): Promise<LlmResponse> {
      rootRequest += 1;
      if (rootRequest === 1) {
        return {
          content: 'I will delegate two independent inspections.',
          toolCalls: [
            {
              id: 'delegate-module',
              tool: 'delegate_task',
              input: {
                task: 'Inspect the module boundary.',
                agentProfileId: 'builtin:ask',
              },
            },
            {
              id: 'delegate-tests',
              tool: 'delegate_task',
              input: {
                task: 'Review the test coverage.',
                agentProfileId: 'builtin:review',
              },
            },
          ],
        };
      }

      const toolMessages = messages.filter(
        (message): message is Extract<ChatMessage, { role: 'tool' }> => message.role === 'tool',
      );
      rootToolOutputs.push(...toolMessages.map((message) => {
        const result = JSON.parse(message.content) as { output: DelegateTaskOutput };
        return result.output;
      }));
      return { content: 'Synthesized module and test findings.' };
    },
  };

  const rootResult = await AgentLoopRuntimeService.run({
    runId: scope.rootRunId,
    goal: 'Inspect the runtime and its tests using independent children.',
    model: 'gpt-test',
    llm: rootAdapter,
    tools: [scope.createTool()],
    includeDefaultTools: false,
    maxSteps: 3,
    maxToolConcurrency: 3,
    workspaceRoot,
    logger: silentLogger,
    systemContext: 'ROOT_PROFILE_SENTINEL',
    history: [
      { role: 'user', content: 'PARENT_HISTORY_SENTINEL' },
      { role: 'assistant', content: 'Prior root-only response.' },
    ],
  });

  return {
    rootResult,
    records: scope.records(),
    rootToolOutputs,
    childMessages,
    childTools,
    childFactoryInputs,
    childAdapters,
    peakActiveChildren,
    activities,
  };
}

function childAdapter(input: {
  task: string;
  onStart: () => void;
  onFinish: () => void;
  onRequest: (messages: ChatMessage[], tools: ToolDefinition[]) => void;
  delayMs?: number;
}): LlmAdapter {
  return {
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
    async chat(messages, tools, _signal, onStreamEvent): Promise<LlmResponse> {
      input.onRequest(messages, tools);
      input.onStart();
      try {
        await delay(input.delayMs ?? (input.task.startsWith('Inspect') ? 20 : 5));
        onStreamEvent?.({ type: 'content.delta', delta: 'Draft child result.' });
        onStreamEvent?.({ type: 'content.done', content: 'Completed child result.' });
        return {
          content: input.task.startsWith('Inspect')
            ? 'Module inspection found the runtime boundary.'
            : 'Test review found complete negative coverage.',
          usage: {
            inputTokens: 20,
            outputTokens: 8,
            totalTokens: 28,
            requests: 1,
          },
        };
      } finally {
        input.onFinish();
      }
    },
  };
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}
