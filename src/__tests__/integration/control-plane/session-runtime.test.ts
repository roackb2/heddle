import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProviderCredentialRepository } from '@/core/auth/index.js';
import { EngineConversationTurnService } from '@/core/chat/engine/turns/service.js';
import { ChatSessionRecords } from '@/core/chat/engine/sessions/records/index.js';
import { FileChatSessionRepository } from '@/core/chat/engine/sessions/repository/index.js';
import * as agentLoopModule from '@/core/runtime/loop/index.js';
import type { AutopilotProfile } from '@/core/approvals/index.js';
import type { ToolApprovalPolicy } from '@/core/approvals/types.js';
import type { RunResult, ToolCall, ToolDefinition } from '@/index.js';
import { controlPlaneChatSessionsController } from '@/server/controllers/trpc/control-plane/chat-sessions-controller.js';

describe('control-plane session runtime integration', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('defaults new control-plane sessions to the shared OpenAI default model', () => {
    vi.stubEnv('OPENAI_MODEL', '');
    vi.stubEnv('ANTHROPIC_MODEL', '');

    const session = controlPlaneChatSessionsController.createSession({
      ...createControlPlaneSessionEngineArgs(),
      suggestedName: 'Default model test',
    });

    expect(session.model).toBe('gpt-5.4');
  });

  it('falls back to an OAuth-compatible model when a configured OpenAI model is unsupported', () => {
    vi.stubEnv('OPENAI_MODEL', 'gpt-4.1');
    vi.stubEnv('OPENAI_API_KEY', '');
    vi.stubEnv('PERSONAL_OPENAI_API_KEY', '');
    const storePath = join(mkdtempSync(join(tmpdir(), 'heddle-control-plane-oauth-')), 'auth.json');
    new ProviderCredentialRepository({ storePath }).set({
      type: 'oauth',
      provider: 'openai',
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresAt: Date.parse('2026-05-02T01:00:00.000Z'),
      accountId: 'account-1234567890',
      createdAt: '2026-05-02T00:00:00.000Z',
      updatedAt: '2026-05-02T00:00:00.000Z',
    });

    const session = controlPlaneChatSessionsController.createSession({
      ...createControlPlaneSessionEngineArgs(),
      suggestedName: 'OAuth fallback test',
      credentialStorePath: storePath,
    });

    expect(session.model).toBe('gpt-5.4');
  });

  it('preserves broader OpenAI model choices in API-key mode', () => {
    vi.stubEnv('OPENAI_MODEL', 'gpt-4.1');
    vi.stubEnv('OPENAI_API_KEY', 'test-openai-key');
    const storePath = join(mkdtempSync(join(tmpdir(), 'heddle-control-plane-api-key-')), 'auth.json');
    new ProviderCredentialRepository({ storePath }).set({
      type: 'oauth',
      provider: 'openai',
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresAt: Date.parse('2026-05-02T01:00:00.000Z'),
      accountId: 'account-1234567890',
      createdAt: '2026-05-02T00:00:00.000Z',
      updatedAt: '2026-05-02T00:00:00.000Z',
    });

    const session = controlPlaneChatSessionsController.createSession({
      ...createControlPlaneSessionEngineArgs(),
      suggestedName: 'API key model test',
      preferApiKey: true,
      credentialStorePath: storePath,
    });

    expect(session.model).toBe('gpt-4.1');
  });

  it('clears explicit reasoning effort when control-plane settings send null', () => {
    const engineArgs = createControlPlaneSessionEngineArgs();
    const session = ChatSessionRecords.create({
      id: 'session-1',
      name: 'Session 1',
      apiKeyPresent: true,
      model: 'gpt-5.5',
      reasoningEffort: 'high',
    });
    new FileChatSessionRepository({ sessionStoragePath: engineArgs.sessionStoragePath }).save([session]);

    const updated = controlPlaneChatSessionsController.updateSettings({
      ...engineArgs,
      sessionId: 'session-1',
      settings: {
        reasoningEffort: null,
      },
    });

    expect(updated.reasoningEffort).toBeUndefined();
    expect(controlPlaneChatSessionsController.readDetail(engineArgs, 'session-1')?.reasoningEffort).toBeUndefined();
  });

  it('continues with the stored prompt while preserving continue-style transcript text', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-control-plane-runtime-'));
    const stateRoot = join(workspaceRoot, '.heddle');
    const sessionStoragePath = resolve(stateRoot, 'chat-sessions.catalog.json');
    const traceDir = resolve(stateRoot, 'traces');
    mkdirSync(traceDir, { recursive: true });
    vi.stubEnv('OPENAI_API_KEY', 'test-openai-key');

    const session = controlPlaneChatSessionsController.createSession({
      workspaceRoot,
      stateRoot,
      sessionStoragePath,
      suggestedName: 'Continue prompt test',
      model: 'gpt-5.1-codex-mini',
      apiKeyPresent: true,
    });

    const loopSpy = vi.spyOn(agentLoopModule.AgentLoopRuntimeService, 'run')
      .mockResolvedValueOnce({
        outcome: 'done',
        summary: 'First turn done.',
        trace: [
          {
            type: 'run.finished',
            outcome: 'done',
            summary: 'First turn done.',
            step: 1,
            timestamp: '2026-04-30T00:00:01.000Z',
          },
        ],
        transcript: [
          { role: 'user', content: 'inspect file with expanded mention contents' },
          { role: 'assistant', content: 'First turn done.' },
        ],
        state: {
          stepCount: 1,
          trace: [],
          toolCallHistory: [],
          runId: 'run-first',
        },
      } as never)
      .mockResolvedValueOnce({
        outcome: 'done',
        summary: 'Continue turn done.',
        trace: [
          {
            type: 'run.finished',
            outcome: 'done',
            summary: 'Continue turn done.',
            step: 1,
            timestamp: '2026-04-30T00:00:02.000Z',
          },
        ],
        transcript: [
          { role: 'user', content: 'inspect file with expanded mention contents' },
          { role: 'assistant', content: 'First turn done.' },
          { role: 'user', content: 'inspect file with expanded mention contents' },
          { role: 'assistant', content: 'Continue turn done.' },
        ],
        state: {
          stepCount: 1,
          trace: [],
          toolCallHistory: [],
          runId: 'run-continue',
        },
      } as never);

    await controlPlaneChatSessionsController.submitPrompt({
      workspaceRoot,
      stateRoot,
      sessionStoragePath,
      sessionId: session.id,
      prompt: 'inspect file with expanded mention contents',
      leaseOwner: {
        ownerKind: 'daemon',
        ownerId: 'daemon-test',
        clientLabel: 'control plane',
      },
    });

    const continueResult = await controlPlaneChatSessionsController.continuePrompt({
      workspaceRoot,
      stateRoot,
      sessionStoragePath,
      sessionId: session.id,
      leaseOwner: {
        ownerKind: 'daemon',
        ownerId: 'daemon-test',
        clientLabel: 'control plane',
      },
    });

    const continueCall = loopSpy.mock.calls.at(-1)?.[0];
    expect(continueCall?.goal).toBe('inspect file with expanded mention contents');

    const detail = controlPlaneChatSessionsController.readDetail({ workspaceRoot, stateRoot, sessionStoragePath }, session.id);
    expect(detail?.messages.map((message) => message.text)).toEqual([
      'inspect file with expanded mention contents',
      'First turn done.',
      'inspect file with expanded mention contents',
      'Continue turn done.',
    ]);
    expect(detail?.lastContinuePrompt).toBe('inspect file with expanded mention contents');
    expect(continueResult.session?.lastContinuePrompt).toBe('inspect file with expanded mention contents');
  });

  it('passes config autopilot policy before remembered approval rules into control-plane turns', async () => {
    const engineArgs = createControlPlaneSessionEngineArgs();
    const autopilot: AutopilotProfile = {
      mode: 'autopilot',
      roots: [{
        path: '.',
        access: 'autopilot',
        allow: ['read', 'write', 'execute', 'many-file-edit'],
      }],
      environments: {
        allow: ['local', 'dev'],
        requireApproval: ['staging', 'production', 'unknown'],
      },
    };
    const session = controlPlaneChatSessionsController.createSession({
      ...engineArgs,
      suggestedName: 'Autopilot policy order test',
      model: 'gpt-5.4',
      autopilot,
    });
    const loopSpy = vi.spyOn(agentLoopModule.AgentLoopRuntimeService, 'run').mockResolvedValue(createLoopResult({
      workspaceRoot: engineArgs.workspaceRoot,
      prompt: 'Run safely.',
      summary: 'Done.',
    }) as never);

    await controlPlaneChatSessionsController.submitPrompt({
      ...engineArgs,
      sessionId: session.id,
      prompt: 'Run safely.',
      autopilot,
      leaseOwner: {
        ownerKind: 'daemon',
        ownerId: 'daemon-test',
        clientLabel: 'control plane',
      },
    });

    const firstPolicy = loopSpy.mock.calls[0]?.[0].approvalPolicies?.[0];
    const decision = await firstPolicy?.({
      workspaceRoot: engineArgs.workspaceRoot,
      call: {
        id: 'call-danger',
        tool: 'run_shell_mutate',
        input: {
          command: 'rm -rf ~',
          policy: {
            operations: ['delete'],
            intent: 'Delete home directory',
            targetRoots: ['.'],
            writeRoots: ['.'],
            expectedEffects: ['delete many files'],
            maxDestructiveScope: 'many-files',
            environment: 'local',
            confidence: 'high',
          },
        },
      },
      tool: {
        name: 'run_shell_mutate',
        description: 'Mutate shell',
        requiresApproval: true,
        parameters: { type: 'object' },
        execute: async () => ({ ok: true }),
      },
    });

    expect(decision).toEqual(expect.objectContaining({
      type: 'deny',
      reason: expect.stringContaining('root/home recursive deletion is blocked'),
    }));
  });
});

describe('conversation turn lifecycle', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('passes approval policies and normalized host surfaces into the run loop', async () => {
    const storage = createConversationTurnStorage();
    const loopSpy = vi.spyOn(agentLoopModule.AgentLoopRuntimeService, 'run').mockResolvedValue(createLoopResult({
      workspaceRoot: storage.workspaceRoot,
      prompt: 'Edit safely.',
      summary: 'Done.',
    }) as never);
    const policy: ToolApprovalPolicy = () => ({ type: 'allow', reason: 'test policy' });
    const requestToolApproval = vi.fn(async () => ({ approved: true, reason: 'approved by host' }));

    await EngineConversationTurnService.run({
      workspaceRoot: storage.workspaceRoot,
      stateRoot: storage.stateRoot,
      traceDir: join(storage.stateRoot, 'traces'),
      sessionStoragePath: storage.sessionStoragePath,
      sessionId: storage.sessionId,
      prompt: 'Edit safely.',
      apiKey: 'explicit-key',
      memoryMaintenanceMode: 'none',
      approvalPolicies: [policy],
      host: {
        approveToolCall: (call, tool) => requestToolApproval({ call, tool }),
      },
    });

    const runOptions = loopSpy.mock.calls[0]?.[0];
    expect(runOptions?.approvalPolicies).toEqual([policy]);
    const call: ToolCall = { id: 'call-1', tool: 'edit_file', input: { path: 'README.md' } };
    const tool: ToolDefinition = {
      name: 'edit_file',
      description: 'Edit file',
      requiresApproval: true,
      parameters: { type: 'object' },
      async execute() {
        return { ok: true };
      },
    };
    await expect(runOptions?.approveToolCall?.(call, tool)).resolves.toEqual({
      approved: true,
      reason: 'approved by host',
    });
    expect(requestToolApproval).toHaveBeenCalledWith({ call, tool });
  });

  it('clears the session lease when the run loop fails', async () => {
    const storage = createConversationTurnStorage();
    vi.spyOn(agentLoopModule.AgentLoopRuntimeService, 'run').mockRejectedValue(new Error('loop failed'));

    await expect(EngineConversationTurnService.run({
      workspaceRoot: storage.workspaceRoot,
      stateRoot: storage.stateRoot,
      sessionStoragePath: storage.sessionStoragePath,
      sessionId: storage.sessionId,
      prompt: 'Fail after preflight.',
      apiKey: 'explicit-key',
      memoryMaintenanceMode: 'none',
      leaseOwner: {
        ownerKind: 'daemon',
        ownerId: 'daemon-test',
        clientLabel: 'control plane',
      },
    })).rejects.toThrow('loop failed');

    const persisted = new FileChatSessionRepository({ sessionStoragePath: storage.sessionStoragePath }).list()
      .find((session) => session.id === storage.sessionId);
    expect(persisted?.lease).toBeUndefined();
    expect(persisted?.turns).toEqual([]);
  });
});

function createControlPlaneSessionEngineArgs() {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-control-plane-runtime-'));
  const stateRoot = join(workspaceRoot, '.heddle');
  return {
    workspaceRoot,
    stateRoot,
    sessionStoragePath: resolve(stateRoot, 'chat-sessions.catalog.json'),
  };
}

function createConversationTurnStorage() {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-conversation-turn-'));
  const stateRoot = join(workspaceRoot, '.heddle');
  const sessionStoragePath = join(stateRoot, 'chat-sessions.catalog.json');
  const session = ChatSessionRecords.create({
    id: 'session-1',
    name: 'Session 1',
    apiKeyPresent: true,
    model: 'gpt-5.4',
  });
  new FileChatSessionRepository({ sessionStoragePath }).save([session]);

  return {
    workspaceRoot,
    stateRoot,
    sessionStoragePath,
    sessionId: session.id,
  };
}

function createLoopResult(args: {
  workspaceRoot: string;
  prompt: string;
  summary: string;
}) {
  const trace: RunResult['trace'] = [
    {
      type: 'assistant.turn',
      content: args.summary,
      requestedTools: false,
      step: 1,
      timestamp: '2026-05-03T00:00:01.000Z',
    },
    {
      type: 'run.finished',
      outcome: 'done',
      summary: args.summary,
      step: 1,
      timestamp: '2026-05-03T00:00:02.000Z',
    },
  ];
  const transcript = [
    { role: 'user' as const, content: args.prompt },
    { role: 'assistant' as const, content: args.summary },
  ];

  return {
    outcome: 'done',
    summary: args.summary,
    trace,
    transcript,
    model: 'gpt-5.4',
    provider: 'openai',
    workspaceRoot: args.workspaceRoot,
    state: {
      status: 'finished',
      runId: 'run-test',
      goal: args.prompt,
      model: 'gpt-5.4',
      provider: 'openai',
      workspaceRoot: args.workspaceRoot,
      startedAt: '2026-05-03T00:00:00.000Z',
      finishedAt: '2026-05-03T00:00:02.000Z',
      outcome: 'done',
      summary: args.summary,
      transcript,
      trace,
    },
  };
}
