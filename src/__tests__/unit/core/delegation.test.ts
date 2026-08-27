import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToolApprovalService } from '@/core/approvals/index.js';
import type { CustomAgentExecutionSnapshot } from '@/core/custom-agents/index.js';
import {
  DelegationService,
  type DelegateTaskOutput,
  type DelegationChildLlmFactory,
  type DelegationChildRuntimeOptions,
  type DelegationPolicyInput,
} from '@/core/delegation/index.js';
import type { LlmAdapter, LlmResponse } from '@/core/llm/types.js';
import {
  AgentLoopRuntimeService,
  type AgentLoopResult,
  type RunAgentLoopOptions,
} from '@/core/runtime/loop/index.js';
import {
  RuntimeToolProfileService,
  RuntimeToolService,
} from '@/core/runtime/tools/index.js';
import type { ToolDefinition, ToolResult } from '@/core/types.js';
import { createLogger } from '@/core/utils/logger.js';

const silentLogger = createLogger({ level: 'silent', console: false });

afterEach(() => {
  vi.restoreAllMocks();
});

describe('delegation policy and scope', () => {
  it('is disabled by default and does not add delegation to the default runtime tools', async () => {
    const workspaceRoot = workspace();
    const service = new DelegationService();
    const scope = service.createRootScope({
      workspaceRoot,
      runtime: { model: 'gpt-test', logger: silentLogger },
    });

    const result = await scope.createTool().execute({ task: 'Inspect the repository.' });
    const defaultTools = RuntimeToolService.createDefaultAgentTools({
      model: 'gpt-test',
      workspaceRoot,
    });

    expect(service.enabled).toBe(false);
    expect(output(result).error?.code).toBe('delegation_disabled');
    expect(scope.records()).toEqual([]);
    expect(defaultTools.map((tool) => tool.name)).not.toContain('delegate_task');
  });

  it('creates one explicit parallel-safe agent.delegate tool with a closed schema', () => {
    const { scope, workspaceRoot } = activeScope();
    const tool = scope.createTool();

    expect(tool).toMatchObject({
      name: 'delegate_task',
      capabilities: ['agent.delegate'],
      concurrency: 'parallel-safe',
      timeoutMs: null,
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['task'],
      },
    });
    expect(RuntimeToolProfileService.apply({
      tools: [tool],
      profile: { preset: 'custom', allowedCapabilities: ['agent.delegate'] },
    }).map((candidate) => candidate.name)).toEqual(['delegate_task']);
    expect(RuntimeToolProfileService.apply({
      tools: [tool],
      profile: { preset: 'inspect' },
    })).toEqual([]);
    expect(() => RuntimeToolService.createDefaultAgentTools({
      model: 'gpt-test',
      workspaceRoot,
      tools: [tool, scope.createTool()],
    })).toThrow('Duplicate runtime tool name: delegate_task');
  });

  it('validates every v1 host limit before a root scope can start', () => {
    const invalidPolicies: DelegationPolicyInput[] = [
      { enabled: true, maxDepth: 2 },
      { enabled: true, maxChildren: 5 },
      { enabled: true, maxConcurrentChildren: 4 },
      { enabled: true, maxChildren: 2, maxConcurrentChildren: 3 },
      { enabled: true, maxStepsPerChild: 33 },
      { enabled: true, maxChildDurationMs: 999 },
      { enabled: true, maxChildDurationMs: 15 * 60_000 + 1 },
      { enabled: true, allowedAgentProfileIds: [] },
      { enabled: true, allowedAgentProfileIds: ['builtin:code'] },
    ];

    invalidPolicies.forEach((policy) => {
      expect(() => new DelegationService({ policy })).toThrow();
    });

    const validService = new DelegationService({ policy: { enabled: true } });
    expect(Object.isFrozen(validService.policy)).toBe(true);
    expect(Object.isFrozen(validService.policy.allowedAgentProfileIds)).toBe(true);
    expect(() => Object.assign(validService.policy, { maxChildren: 99 })).toThrow(TypeError);
  });

  it('returns stable safe rejections for invalid tasks, disallowed agents, and depth two', async () => {
    const { scope } = activeScope({
      policy: { allowedAgentProfileIds: ['builtin:ask'] },
    });

    const invalidTask = await scope.delegateTask({ task: '   ' });
    const unknownField = await scope.delegateTask({ task: 'Inspect.', depth: 1 });
    const disallowedAgent = await scope.delegateTask({
      task: 'Review the repository.',
      agentProfileId: 'builtin:review',
    });
    const depthTwo = await scope.delegateTask(
      { task: 'Try nested delegation.' },
      { parentDepth: 1 },
    );

    expect(output(invalidTask).error?.code).toBe('invalid_task');
    expect(output(unknownField).error?.code).toBe('invalid_task');
    expect(output(disallowedAgent).error?.code).toBe('agent_not_allowed');
    expect(output(depthTwo).error?.code).toBe('depth_limit');
    expect(scope.records()).toEqual([]);
  });

  it('defaults an omitted profile to the host-allowed review worker when ask is unavailable', async () => {
    const { scope } = activeScope({
      policy: { allowedAgentProfileIds: ['builtin:review'] },
    });

    const result = await scope.delegateTask({ task: 'Review safely.' });
    const tool = scope.createTool();

    expect(result.ok).toBe(true);
    expect(tool.description).toContain('omitted to use builtin:review');
    expect(tool.parameters).toMatchObject({
      properties: {
        agentProfileId: {
          description: 'Read-only child profile. Omit to use builtin:review.',
        },
      },
    });
    expect(scope.records()[0]?.agentSnapshot.agentProfileId).toBe('builtin:review');
  });

  it('consumes the total slot after success, provider failure, and cancellation', async () => {
    let cancelStarted!: () => void;
    const started = new Promise<void>((resolveStarted) => {
      cancelStarted = resolveStarted;
    });
    const { scope } = activeScope({
      createChildLlm: ({ task }) => taskAdapter(task, cancelStarted),
    });

    const success = await scope.delegateTask({ task: 'success-one' });
    const failure = await scope.delegateTask({ task: 'provider-failure' });
    const controller = new AbortController();
    const cancellationPromise = scope.delegateTask(
      { task: 'cancel-me' },
      { signal: controller.signal },
    );
    await started;
    controller.abort();
    const cancellation = await cancellationPromise;
    const finalSuccess = await scope.delegateTask({ task: 'success-two' });
    const fifth = await scope.delegateTask({ task: 'over-limit' });

    expect(success.ok).toBe(true);
    expect(output(failure)).toMatchObject({
      outcome: 'error',
      error: { code: 'child_failed' },
    });
    expect(output(cancellation)).toMatchObject({
      outcome: 'interrupted',
      error: { code: 'cancelled' },
    });
    expect(finalSuccess.ok).toBe(true);
    expect(output(fifth).error?.code).toBe('child_limit');
    expect(JSON.stringify([failure, cancellation])).not.toContain('raw-provider-secret');
    expect(scope.records().map((record) => record.outcome)).toEqual([
      'done',
      'error',
      'interrupted',
      'done',
    ]);
  });

  it('never executes more than three reserved children concurrently', async () => {
    let active = 0;
    let peak = 0;
    const { scope } = activeScope({
      createChildLlm: ({ task }) => finalAdapter(async () => {
        active += 1;
        peak = Math.max(peak, active);
        await delay(20);
        active -= 1;
        return { content: `Completed ${task}.` };
      }),
    });

    const results = await Promise.all([
      scope.delegateTask({ task: 'one' }),
      scope.delegateTask({ task: 'two' }),
      scope.delegateTask({ task: 'three' }),
      scope.delegateTask({ task: 'four' }),
    ]);

    expect(results.every((result) => result.ok)).toBe(true);
    expect(peak).toBe(3);
    expect(active).toBe(0);
  });

  it('rejects a child adapter instance reused by a custom host factory', async () => {
    const sharedAdapter = finalAdapter(async () => ({ content: 'Shared result.' }));
    const { scope } = activeScope({
      createChildLlm: () => sharedAdapter,
    });

    const first = await scope.delegateTask({ task: 'first' });
    const second = await scope.delegateTask({ task: 'second' });

    expect(first.ok).toBe(true);
    expect(output(second).error?.code).toBe('child_failed');
    expect(JSON.stringify(second)).not.toContain('fresh adapter');
    expect(scope.records().at(1)).toMatchObject({
      status: 'finished',
      outcome: 'error',
    });
  });

  it('intersects snapshot tools with the exact delegated read-only allowlist', async () => {
    const workspaceRoot = workspace();
    const snapshot = askSnapshot({
      toolProfile: {
        preset: 'inspect',
        includeTools: [
          'read_file',
          'edit_file',
          'run_shell_inspect',
          'read_agent_skill',
          'delegate_task',
        ],
        memoryMode: 'none',
      },
    });
    const unsafeTools: ToolDefinition[] = ([
      ['forged_mutation', 'workspace.write'],
      ['forged_shell', 'shell.inspect'],
      ['forged_external_read', 'external.read'],
      ['forged_memory_read', 'memory.read'],
      ['forged_artifact_read', 'artifact.read'],
      ['read_agent_skill', 'workspace.read'],
      ['forged_future_read', 'workspace.read'],
    ] as const).map(([name, capability]) => ({
      name,
      description: `A forged ${capability} tool used to test defense in depth.`,
      capabilities: [capability],
      parameters: {},
      execute: async () => ({ ok: true }),
    }));
    let captured: RunAgentLoopOptions | undefined;
    vi.spyOn(AgentLoopRuntimeService, 'run').mockImplementation(async (options) => {
      captured = options;
      return completedResult(options, 'Read-only child result.');
    });
    const scope = new DelegationService({
      policy: { enabled: true, allowedAgentProfileIds: ['builtin:ask'] },
    }).createRootScope({
      rootRunId: 'run_read-only-root',
      workspaceRoot,
      runtime: {
        model: 'gpt-test',
        baseSystemContext: 'BASE_PROJECT_CONTEXT',
        logger: silentLogger,
        extraTools: unsafeTools,
        llm: finalAdapter(async () => ({ content: 'Unsafe shared adapter.' })),
      } as unknown as DelegationChildRuntimeOptions,
      agentSnapshotResolver: {
        resolveExecutionSnapshot: () => snapshot,
      },
    });

    const result = await scope.delegateTask({ task: 'Inspect safely.' });
    const tools = captured?.tools ?? [];
    const approvalService = new ToolApprovalService();
    const approvals = await Promise.all(unsafeTools.map(async (tool) => (
      await approvalService.evaluate({
        policies: captured?.approvalPolicies ?? [],
        context: {
          call: { id: `call-${tool.name}`, tool: tool.name, input: {} },
          tool,
          workspaceRoot,
        },
      })
    )));
    const readFileTool = tools.find((tool) => tool.name === 'read_file');
    const safeApproval = readFileTool
      ? await approvalService.evaluate({
        policies: captured?.approvalPolicies ?? [],
        context: {
          call: { id: 'call-read-file', tool: readFileTool.name, input: {} },
          tool: readFileTool,
          workspaceRoot,
        },
      })
      : undefined;

    expect(result.ok).toBe(true);
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'list_files',
      'project_dashboard',
      'read_file',
      'search_files',
    ]);
    expect(tools.map((tool) => tool.name)).not.toEqual(expect.arrayContaining([
      'edit_file',
      'delegate_task',
      'run_shell_inspect',
      'run_shell_mutate',
      'read_artifact',
      'read_agent_skill',
      'mcp_call_tool',
    ]));
    expect(tools.every((tool) => RuntimeToolProfileService.capabilitiesFor(tool).every(
      (capability) => capability === 'workspace.read',
    ))).toBe(true);
    expect(approvals).toEqual(unsafeTools.map((tool) => ({
      type: 'deny',
      reason: `${tool.name} is outside the delegated read-only tool allowlist`,
    })));
    expect(safeApproval).toBeUndefined();
    expect(captured).toMatchObject({
      runId: expect.stringMatching(/^run_/),
      goal: 'Inspect safely.',
      workspaceRoot,
      includeDefaultTools: false,
      history: [],
      maxSteps: 24,
    });
    expect(captured?.extraTools).toBeUndefined();
    expect(captured?.llm).toBeUndefined();
    expect(captured?.systemContext).toContain('BASE_PROJECT_CONTEXT');
    expect(captured?.systemContext).toContain('You are running in ask mode.');
    expect(captured?.systemContext).not.toContain('ROOT_PROFILE_CONTEXT');
    expect(scope.records()[0]?.agentSnapshot.definitionHash).toBe(snapshot.definitionHash);
    expect(output(result)).not.toHaveProperty('trace');
    expect(output(result)).not.toHaveProperty('usage');
  });

  it('fails closed before root execution when an eligible snapshot is not read-only', () => {
    const unsafeSnapshot = askSnapshot({
      toolProfile: { preset: 'default' },
    });

    expect(() => new DelegationService({
      policy: { enabled: true, allowedAgentProfileIds: ['builtin:ask'] },
    }).createRootScope({
      workspaceRoot: workspace(),
      runtime: { model: 'gpt-test', logger: silentLogger },
      agentSnapshotResolver: {
        resolveExecutionSnapshot: () => unsafeSnapshot,
      },
    })).toThrow('not safely read-only');
  });

  it('cancels the active child and settles queued reservations without starting them', async () => {
    let adaptersCreated = 0;
    let active = 0;
    let firstStarted!: () => void;
    const started = new Promise<void>((resolveStarted) => {
      firstStarted = resolveStarted;
    });
    const { scope } = activeScope({
      policy: { maxConcurrentChildren: 1 },
      createChildLlm: () => {
        adaptersCreated += 1;
        return finalAdapter(async (_messages, _tools, signal) => {
          active += 1;
          firstStarted();
          try {
            return await rejectWhenAborted(signal);
          } finally {
            active -= 1;
          }
        });
      },
    });

    const pending = [
      scope.delegateTask({ task: 'active' }),
      scope.delegateTask({ task: 'queued-one' }),
      scope.delegateTask({ task: 'queued-two' }),
    ];
    await started;
    scope.cancel('root cancelled');
    const results = await Promise.all(pending);

    expect(results.map((result) => output(result).error?.code)).toEqual([
      'cancelled',
      'cancelled',
      'cancelled',
    ]);
    expect(adaptersCreated).toBe(1);
    expect(active).toBe(0);
    expect(scope.records().every((record) => record.status === 'cancelled')).toBe(true);
  });

  it('settles a child with a distinct timeout after its execution deadline', async () => {
    vi.useFakeTimers();
    let markStarted!: () => void;
    const started = new Promise<void>((resolveStarted) => {
      markStarted = resolveStarted;
    });
    const { scope } = activeScope({
      policy: { maxChildDurationMs: 1_000 },
      createChildLlm: () => finalAdapter(async (_messages, _tools, signal) => {
        markStarted();
        return await rejectWhenAborted(signal);
      }),
    });

    try {
      const pending = scope.delegateTask({ task: 'Wait past the child deadline.' });
      await started;
      await vi.advanceTimersByTimeAsync(1_000);

      await expect(pending).resolves.toMatchObject({
        ok: false,
        output: {
          status: 'cancelled',
          outcome: 'interrupted',
          error: { code: 'child_timeout' },
        },
      });
      expect(scope.records()).toEqual([
        expect.objectContaining({
          status: 'cancelled',
          outcome: 'interrupted',
          summary: 'The delegated child exceeded its wall-clock limit.',
        }),
      ]);
    } finally {
      await scope.cancelAndWait();
      vi.useRealTimers();
    }
  });
});

function activeScope(options: {
  policy?: DelegationPolicyInput;
  createChildLlm?: DelegationChildLlmFactory;
} = {}) {
  const workspaceRoot = workspace();
  const service = new DelegationService({
    policy: {
      enabled: true,
      ...options.policy,
    },
  });
  const scope = service.createRootScope({
    rootRunId: 'run_delegation-unit-root',
    workspaceRoot,
    runtime: {
      model: 'gpt-test',
      logger: silentLogger,
      createChildLlm: options.createChildLlm
        ?? (() => finalAdapter(async () => ({ content: 'Child completed.' }))),
    },
  });
  return { scope, service, workspaceRoot };
}

function workspace(): string {
  return mkdtempSync(join(tmpdir(), 'heddle-delegation-'));
}

function output(result: ToolResult): DelegateTaskOutput {
  return result.output as DelegateTaskOutput;
}

function finalAdapter(
  chat: LlmAdapter['chat'],
): LlmAdapter {
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
    chat,
  };
}

function taskAdapter(task: string, cancelStarted: () => void): LlmAdapter {
  if (task === 'provider-failure') {
    return finalAdapter(async () => {
      throw Object.assign(new Error('raw-provider-secret'), { status: 401 });
    });
  }
  if (task === 'cancel-me') {
    return finalAdapter(async (_messages, _tools, signal) => {
      cancelStarted();
      return await rejectWhenAborted(signal);
    });
  }
  return finalAdapter(async () => ({ content: `Completed ${task}.` }));
}

async function rejectWhenAborted(signal: AbortSignal | undefined): Promise<LlmResponse> {
  if (!signal) {
    throw new Error('Expected an abort signal');
  }
  if (signal.aborted) {
    throw abortError();
  }

  return await new Promise<LlmResponse>((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(abortError()), { once: true });
  });
}

function abortError(): Error {
  return Object.assign(new Error('raw cancellation detail'), { name: 'AbortError' });
}

function askSnapshot(
  overrides: Partial<CustomAgentExecutionSnapshot> = {},
): CustomAgentExecutionSnapshot {
  return {
    agentProfileId: 'builtin:ask',
    agentName: 'Ask',
    modeAlias: 'ask',
    source: 'built-in',
    definitionHash: '0123456789abcdef',
    runtime: { maxSteps: 60 },
    toolProfile: {
      preset: 'inspect',
      includeTools: ['read_file'],
      memoryMode: 'none',
    },
    approvalProfile: { preset: 'read_only' },
    systemContextAppendix: 'You are running in ask mode. Inspect without changing project state.',
    ...overrides,
  };
}

function completedResult(
  options: RunAgentLoopOptions,
  summary: string,
): AgentLoopResult {
  const runId = options.runId ?? 'run-test';
  const model = options.model ?? 'gpt-test';
  const workspaceRoot = options.workspaceRoot ?? process.cwd();
  const startedAt = '2026-08-25T00:00:00.000Z';
  const finishedAt = '2026-08-25T00:00:01.000Z';
  return {
    outcome: 'done',
    summary,
    trace: [],
    transcript: [],
    model,
    provider: 'openai',
    workspaceRoot,
    state: {
      status: 'finished',
      runId,
      goal: options.goal,
      model,
      provider: 'openai',
      workspaceRoot,
      startedAt,
      finishedAt,
      outcome: 'done',
      summary,
      transcript: [],
      trace: [],
    },
  };
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}
