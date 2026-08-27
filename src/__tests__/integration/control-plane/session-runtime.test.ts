import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import omit from 'lodash/omit.js';
import { ProviderCredentialRepository } from '@/core/auth/index.js';
import { ArtifactService } from '@/core/artifacts/index.js';
import type { CustomAgentExecutionSnapshot } from '@/core/custom-agents/index.js';
import { LlmAdapterService } from '@/core/llm/index.js';
import type { ChatMessage, LlmAdapter, LlmResponse } from '@/core/llm/types.js';
import type { ConversationActivity } from '@/core/live/index.js';
import { EngineConversationTurnService } from '@/core/chat/engine/turns/service.js';
import { ConversationTurnMemoryMaintenance } from '@/core/chat/engine/turns/memory/index.js';
import { FileConversationSessionService } from '@/core/chat/engine/sessions/service.js';
import {
  ChatSessionLeases,
  SESSION_LEASE_REFRESH_INTERVAL_MS,
  SESSION_LEASE_STALE_AFTER_MS,
} from '@/core/chat/engine/sessions/leases/index.js';
import { ChatSessionRecords } from '@/core/chat/engine/sessions/records/index.js';
import { FileChatSessionRepository } from '@/core/chat/engine/sessions/repository/index.js';
import { readStoredChatSession } from '@/__tests__/helpers/chat-session-repository.js';
import * as agentLoopModule from '@/core/runtime/loop/index.js';
import type { AutonomyPermissionGrant, AutopilotProfile } from '@/core/approvals/index.js';
import type { ToolApprovalPolicy } from '@/core/approvals/types.js';
import type { RunResult, ToolCall, ToolDefinition } from '@/index.js';
import { controlPlaneChatSessionsController } from '@/server/controllers/trpc/control-plane/chat-sessions-controller.js';

describe('control-plane session runtime integration', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('defaults new control-plane sessions to the shared OpenAI default model', async () => {
    vi.stubEnv('OPENAI_MODEL', '');
    vi.stubEnv('ANTHROPIC_MODEL', '');

    const session = await controlPlaneChatSessionsController.createSession({
      ...createControlPlaneSessionEngineArgs(),
      suggestedName: 'Default model test',
    });

    expect(session.model).toBe('gpt-5.4');
  });

  it('falls back to an OAuth-compatible model when a configured OpenAI model is unsupported', async () => {
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

    const session = await controlPlaneChatSessionsController.createSession({
      ...createControlPlaneSessionEngineArgs(),
      suggestedName: 'OAuth fallback test',
      credentialStorePath: storePath,
    });

    expect(session.model).toBe('gpt-5.4');
  });

  it('preserves broader OpenAI model choices in API-key mode', async () => {
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

    const session = await controlPlaneChatSessionsController.createSession({
      ...createControlPlaneSessionEngineArgs(),
      suggestedName: 'API key model test',
      preferApiKey: true,
      credentialStorePath: storePath,
    });

    expect(session.model).toBe('gpt-4.1');
  });

  it('clears explicit reasoning effort when control-plane settings send null', async () => {
    const engineArgs = createControlPlaneSessionEngineArgs();
    const session = ChatSessionRecords.create({
      id: 'session-1',
      name: 'Session 1',
      apiKeyPresent: true,
      model: 'gpt-5.5',
      reasoningEffort: 'high',
    });
    await new FileChatSessionRepository({ sessionStoragePath: engineArgs.sessionStoragePath }).create(session);

    const updated = await controlPlaneChatSessionsController.updateSettings({
      ...engineArgs,
      sessionId: 'session-1',
      settings: {
        reasoningEffort: null,
      },
    });

    expect(updated.reasoningEffort).toBeUndefined();
    expect((await controlPlaneChatSessionsController.readDetail(engineArgs, 'session-1'))?.reasoningEffort).toBeUndefined();
  });

  it('continues with the stored prompt while preserving continue-style transcript text', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-control-plane-runtime-'));
    const stateRoot = join(workspaceRoot, '.heddle');
    const sessionStoragePath = resolve(stateRoot, 'chat-sessions.catalog.json');
    const traceDir = resolve(stateRoot, 'traces');
    mkdirSync(traceDir, { recursive: true });
    vi.stubEnv('OPENAI_API_KEY', 'test-openai-key');

    const session = await controlPlaneChatSessionsController.createSession({
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
        hostId: 'test-host',
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
        hostId: 'test-host',
        ownerId: 'daemon-test',
        clientLabel: 'control plane',
      },
    });

    const continueCall = loopSpy.mock.calls.at(-1)?.[0];
    expect(continueCall?.goal).toBe('inspect file with expanded mention contents');

    const detail = await controlPlaneChatSessionsController.readDetail({ workspaceRoot, stateRoot, sessionStoragePath }, session.id);
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
    const permissionGrant: AutonomyPermissionGrant = {
      mode: 'custom',
      boundaryBehavior: 'request',
      authority: { kind: 'autopilot', profile: autopilot },
    };
    const session = await controlPlaneChatSessionsController.createSession({
      ...engineArgs,
      suggestedName: 'Autopilot policy order test',
      model: 'gpt-5.4',
      permissionGrant,
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
      permissionGrant,
      apiKey: 'test-openai-key',
      leaseOwner: {
        ownerKind: 'daemon',
        hostId: 'test-host',
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

  it('places the unrestricted fallback after explicit control-plane policies', async () => {
    const engineArgs = createControlPlaneSessionEngineArgs();
    const permissionGrant: AutonomyPermissionGrant = {
      mode: 'unrestricted',
      boundaryBehavior: 'allow',
      authority: { kind: 'unrestricted' },
    };
    const explicitDeny: ToolApprovalPolicy = () => ({
      type: 'deny',
      reason: 'Blocked by explicit host policy',
    });
    const session = await controlPlaneChatSessionsController.createSession({
      ...engineArgs,
      suggestedName: 'Unrestricted policy order test',
      model: 'gpt-5.4',
      permissionGrant,
      approvalPolicies: [explicitDeny],
    });
    const loopSpy = vi.spyOn(agentLoopModule.AgentLoopRuntimeService, 'run').mockResolvedValue(createLoopResult({
      workspaceRoot: engineArgs.workspaceRoot,
      prompt: 'Run without prompts.',
      summary: 'Done.',
    }) as never);

    await controlPlaneChatSessionsController.submitPrompt({
      ...engineArgs,
      sessionId: session.id,
      prompt: 'Run without prompts.',
      permissionGrant,
      approvalPolicies: [explicitDeny],
      apiKey: 'test-openai-key',
      leaseOwner: {
        ownerKind: 'daemon',
        hostId: 'test-host',
        ownerId: 'daemon-test',
        clientLabel: 'control plane',
      },
    });

    const policies = loopSpy.mock.calls[0]?.[0].approvalPolicies ?? [];
    expect(policies).toHaveLength(3);
    expect(policies[0]).toBe(explicitDeny);
  });
});

describe('conversation turn lifecycle', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('passes approval policies and normalized host surfaces into the run loop', async () => {
    const storage = await createConversationTurnStorage();
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
      artifactRoot: storage.artifactRoot,
      artifactsEnabled: true,
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

  it('persists two completed child records and reopens them with the parent turn', async () => {
    const storage = await createConversationTurnStorage();
    const childMessages: ChatMessage[][] = [];
    const childToolNames: string[][] = [];
    let rootToolNames: string[] = [];
    let rootToolOutputs: unknown[] = [];
    const activities: ConversationActivity[] = [];
    let rootRequest = 0;
    const rootAdapter = testAdapter(async (messages, tools) => {
      rootToolNames = (tools ?? []).map((tool) => tool.name);
      rootRequest += 1;
      if (rootRequest === 1) {
        return {
          content: 'I will delegate an independent inspection.',
          toolCalls: [
            {
              id: 'delegate-one',
              tool: 'delegate_task',
              input: {
                task: 'Inspect the conversation engine boundary.',
                agentProfileId: 'builtin:ask',
              },
            },
            {
              id: 'delegate-two',
              tool: 'delegate_task',
              input: {
                task: 'Review the conversation persistence boundary.',
                agentProfileId: 'builtin:review',
              },
            },
          ],
        };
      }

      const toolMessages = messages.filter(
        (message): message is Extract<ChatMessage, { role: 'tool' }> => message.role === 'tool',
      );
      rootToolOutputs = toolMessages.map((message) => JSON.parse(message.content));
      return { content: 'Root synthesized the delegated inspection.' };
    });
    const childAdapter = (summary: string) => testAdapter(async (messages, tools) => {
      childMessages.push(structuredClone(messages));
      childToolNames.push((tools ?? []).map((tool) => tool.name));
      return {
        content: summary,
        usage: {
          inputTokens: 12,
          outputTokens: 8,
          totalTokens: 20,
          requests: 1,
        },
      };
    });
    vi.spyOn(LlmAdapterService, 'create')
      .mockReturnValueOnce(rootAdapter)
      .mockReturnValueOnce(childAdapter('The conversation engine owns the persisted turn boundary.'))
      .mockReturnValueOnce(childAdapter('The session repository owns durable turn summaries.'));

    const turnResult = await EngineConversationTurnService.run({
      workspaceRoot: storage.workspaceRoot,
      stateRoot: storage.stateRoot,
      traceDir: join(storage.stateRoot, 'traces'),
      sessionStoragePath: storage.sessionStoragePath,
      sessionId: storage.sessionId,
      prompt: 'Inspect this architecture with help when useful.',
      apiKey: 'explicit-key',
      systemContext: 'BASE_SYSTEM_CONTEXT',
      agentSnapshot: rootAgentSnapshot(),
      host: {
        onActivity: (activity) => activities.push(structuredClone(activity)),
      },
      memoryMaintenanceMode: 'none',
      artifactRoot: storage.artifactRoot,
      artifactsEnabled: true,
    });

    expect(rootToolNames).toContain('delegate_task');
    expect(childToolNames).toEqual([
      ['project_dashboard', 'list_files', 'read_file', 'search_files'],
      ['project_dashboard', 'list_files', 'read_file', 'search_files'],
    ]);
    expect(JSON.stringify(childMessages)).toContain('BASE_SYSTEM_CONTEXT');
    expect(JSON.stringify(childMessages)).not.toContain('ROOT_PROFILE_SENTINEL');
    expect(rootToolOutputs).toHaveLength(2);
    expect(rootToolOutputs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        ok: true,
        output: expect.objectContaining({ status: 'finished', outcome: 'done' }),
      }),
    ]));
    expect(turnResult).toEqual(expect.objectContaining({
      outcome: 'done',
      summary: 'Root synthesized the delegated inspection.',
      delegation: expect.objectContaining({
        policy: expect.objectContaining({ enabled: true }),
        records: [
          expect.objectContaining({
            task: 'Inspect the conversation engine boundary.',
            status: 'finished',
            outcome: 'done',
            summary: 'The conversation engine owns the persisted turn boundary.',
          }),
          expect.objectContaining({
            task: 'Review the conversation persistence boundary.',
            status: 'finished',
            outcome: 'done',
            summary: 'The session repository owns durable turn summaries.',
          }),
        ],
      }),
    }));
    expect(turnResult.delegation?.records[0]?.rootRunId).toBe(turnResult.delegation?.rootRunId);
    const reopened = await readStoredChatSession(
      new FileChatSessionRepository({ sessionStoragePath: storage.sessionStoragePath }),
      storage.sessionId,
    );
    const persistedDelegations = reopened?.turns.at(-1)?.delegations;
    expect(persistedDelegations).toEqual(
      turnResult.delegation?.records.map((record) => omit(record, ['trace', 'model', 'provider'])),
    );
    expect(persistedDelegations?.every((record) => (
      !('trace' in record)
      && !('transcript' in record)
      && !('model' in record)
      && !('provider' in record)
      && record.agentSnapshot.definitionHash.length > 0
      && record.usage?.requests === 1
    ))).toBe(true);
    expect(activities).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: 'delegation',
        type: 'delegation.started',
        rootRunId: turnResult.delegation?.rootRunId,
        depth: 1,
      }),
      expect.objectContaining({
        source: 'delegation',
        type: 'delegation.child.activity',
        rootRunId: turnResult.delegation?.rootRunId,
        activity: expect.objectContaining({ type: 'loop.started' }),
      }),
      expect.objectContaining({
        source: 'delegation',
        type: 'delegation.finished',
        rootRunId: turnResult.delegation?.rootRunId,
        outcome: 'done',
      }),
    ]));
  });

  it('propagates parent cancellation into an active delegated child', async () => {
    const storage = await createConversationTurnStorage();
    const controller = new AbortController();
    let markChildStarted!: () => void;
    const childStarted = new Promise<void>((resolveStarted) => {
      markChildStarted = resolveStarted;
    });
    let rootRequest = 0;
    const rootAdapter = testAdapter(async () => {
      rootRequest += 1;
      return rootRequest === 1
        ? {
            content: 'Delegating a cancellable inspection.',
            toolCalls: [{
              id: 'delegate-cancellable',
              tool: 'delegate_task',
              input: { task: 'Wait for the parent cancellation.' },
            }],
          }
        : { content: 'This response should not be needed after cancellation.' };
    });
    const childAdapter = testAdapter(async (_messages, _tools, signal) => {
      markChildStarted();
      return await rejectAdapterWhenAborted(signal);
    });
    vi.spyOn(LlmAdapterService, 'create')
      .mockReturnValueOnce(rootAdapter)
      .mockReturnValueOnce(childAdapter);

    const turn = EngineConversationTurnService.run({
      workspaceRoot: storage.workspaceRoot,
      stateRoot: storage.stateRoot,
      traceDir: join(storage.stateRoot, 'traces'),
      sessionStoragePath: storage.sessionStoragePath,
      sessionId: storage.sessionId,
      prompt: 'Delegate this, then stop when I cancel.',
      apiKey: 'explicit-key',
      abortSignal: controller.signal,
      memoryMaintenanceMode: 'none',
      artifactRoot: storage.artifactRoot,
      artifactsEnabled: true,
    });
    await childStarted;
    controller.abort(Object.assign(new Error('cancel parent turn'), { name: 'AbortError' }));

    await expect(turn).resolves.toEqual(expect.objectContaining({
      outcome: 'interrupted',
      delegation: expect.objectContaining({
        records: [expect.objectContaining({
          status: 'cancelled',
          outcome: 'interrupted',
        })],
      }),
    }));
  });

  it('removes delegation entirely for an off turn', async () => {
    const storage = await createConversationTurnStorage();
    await expect(EngineConversationTurnService.run({
      workspaceRoot: storage.workspaceRoot,
      stateRoot: storage.stateRoot,
      traceDir: join(storage.stateRoot, 'traces'),
      sessionStoragePath: storage.sessionStoragePath,
      sessionId: storage.sessionId,
      prompt: 'Reject an invalid delegation mode.',
      apiKey: 'explicit-key',
      delegation: 'invalid' as never,
      memoryMaintenanceMode: 'none',
      artifactRoot: storage.artifactRoot,
      artifactsEnabled: true,
    })).rejects.toThrow('conversation delegation mode must be auto or off');

    const loopSpy = vi.spyOn(agentLoopModule.AgentLoopRuntimeService, 'run').mockResolvedValue(createLoopResult({
      workspaceRoot: storage.workspaceRoot,
      prompt: 'Run without delegation.',
      summary: 'Handled directly.',
    }) as never);

    const turnResult = await EngineConversationTurnService.run({
      workspaceRoot: storage.workspaceRoot,
      stateRoot: storage.stateRoot,
      traceDir: join(storage.stateRoot, 'traces'),
      sessionStoragePath: storage.sessionStoragePath,
      sessionId: storage.sessionId,
      prompt: 'Run without delegation.',
      apiKey: 'explicit-key',
      delegation: 'off',
      memoryMaintenanceMode: 'none',
      artifactRoot: storage.artifactRoot,
      artifactsEnabled: true,
    });

    expect(loopSpy.mock.calls[0]?.[0].tools?.map((tool) => tool.name)).not.toContain('delegate_task');
    expect(loopSpy.mock.calls[0]?.[0].runId).toBeUndefined();
    expect(turnResult.delegation).toBeUndefined();
    const reopened = await readStoredChatSession(
      new FileChatSessionRepository({ sessionStoragePath: storage.sessionStoragePath }),
      storage.sessionId,
    );
    expect(reopened?.turns.at(-1)).not.toHaveProperty('delegations');
  });

  it('returns persisted trace, session artifacts, completed tool results, and memory changes to hosts', async () => {
    const storage = await createConversationTurnStorage();
    const artifact = new ArtifactService({ artifactRoot: storage.artifactRoot }).saveText({
      sessionId: storage.sessionId,
      content: '# Brief',
      kind: 'source',
      domain: 'document',
      title: 'brief.md',
      sourceTool: 'doc_create',
    });
    const call: ToolCall = { id: 'call-1', tool: 'doc_create', input: { title: 'Brief' } };
    const result = { ok: true, output: { artifactId: artifact.id } };
    vi.spyOn(agentLoopModule.AgentLoopRuntimeService, 'run').mockResolvedValue(createLoopResult({
      workspaceRoot: storage.workspaceRoot,
      prompt: 'Create a brief.',
      summary: 'Created.',
      trace: [
        {
          type: 'tool.completed',
          call,
          result,
          durationMs: 42,
          step: 1,
          timestamp: '2026-05-03T00:00:01.000Z',
        },
        {
          type: 'memory.candidate_recorded',
          candidateId: 'candidate-1',
          path: '_maintenance/candidates.jsonl',
          step: 1,
          timestamp: '2026-05-03T00:00:01.500Z',
        },
        {
          type: 'run.finished',
          outcome: 'done',
          summary: 'Created.',
          step: 2,
          timestamp: '2026-05-03T00:00:02.000Z',
        },
      ],
    }) as never);

    const turnResult = await EngineConversationTurnService.run({
      workspaceRoot: storage.workspaceRoot,
      stateRoot: storage.stateRoot,
      traceDir: join(storage.stateRoot, 'traces'),
      sessionStoragePath: storage.sessionStoragePath,
      sessionId: storage.sessionId,
      prompt: 'Create a brief.',
      apiKey: 'explicit-key',
      memoryMaintenanceMode: 'none',
      artifactRoot: storage.artifactRoot,
      artifactsEnabled: true,
    });

    expect(turnResult.traceFile).toEqual(expect.stringContaining('trace-'));
    expect(turnResult.artifacts).toEqual([
      expect.objectContaining({
        id: artifact.id,
        kind: 'source',
        domain: 'document',
        sessionId: storage.sessionId,
        sourceTool: 'doc_create',
      }),
    ]);
    expect(turnResult.toolResults).toEqual([
      {
        call,
        result,
        durationMs: 42,
        step: 1,
        timestamp: '2026-05-03T00:00:01.000Z',
      },
    ]);
    expect(turnResult.memory).toEqual({ changed: true });
  });

  it('waits for background memory maintenance before reporting a memory change', async () => {
    const storage = await createConversationTurnStorage();
    vi.spyOn(agentLoopModule.AgentLoopRuntimeService, 'run').mockResolvedValue(createLoopResult({
      workspaceRoot: storage.workspaceRoot,
      prompt: 'Remember this.',
      summary: 'Remembered.',
      trace: [{
        type: 'memory.candidate_recorded',
        candidateId: 'candidate-1',
        path: '_maintenance/candidates.jsonl',
        step: 1,
        timestamp: '2026-05-03T00:00:01.000Z',
      }],
    }) as never);

    let completeMaintenance!: () => void;
    const maintenanceBoundary = new Promise<void>((resolvePromise) => {
      completeMaintenance = resolvePromise;
    });
    const maintenanceSpy = vi.spyOn(ConversationTurnMemoryMaintenance, 'runBackground')
      .mockReturnValue(maintenanceBoundary);

    let settled = false;
    const turn = EngineConversationTurnService.run({
      workspaceRoot: storage.workspaceRoot,
      stateRoot: storage.stateRoot,
      traceDir: join(storage.stateRoot, 'traces'),
      sessionStoragePath: storage.sessionStoragePath,
      sessionId: storage.sessionId,
      prompt: 'Remember this.',
      apiKey: 'explicit-key',
      memoryMaintenanceMode: 'background',
      artifactRoot: storage.artifactRoot,
      artifactsEnabled: true,
    }).finally(() => {
      settled = true;
    });

    await vi.waitFor(() => expect(maintenanceSpy).toHaveBeenCalledOnce());
    expect(settled).toBe(false);

    completeMaintenance();
    await expect(turn).resolves.toEqual(expect.objectContaining({
      memory: { changed: true },
    }));
  });

  it('returns the safe model failure category to programmatic hosts', async () => {
    const storage = await createConversationTurnStorage();
    vi.spyOn(agentLoopModule.AgentLoopRuntimeService, 'run').mockResolvedValue(createLoopResult({
      workspaceRoot: storage.workspaceRoot,
      prompt: 'Use a rejected credential.',
      summary: 'LLM error: Model authentication failed',
      outcome: 'error',
      failure: { source: 'model', code: 'authentication' },
    }) as never);

    const turnResult = await EngineConversationTurnService.run({
      workspaceRoot: storage.workspaceRoot,
      stateRoot: storage.stateRoot,
      traceDir: join(storage.stateRoot, 'traces'),
      sessionStoragePath: storage.sessionStoragePath,
      sessionId: storage.sessionId,
      prompt: 'Use a rejected credential.',
      apiKey: 'rejected-key',
      memoryMaintenanceMode: 'none',
      artifactRoot: storage.artifactRoot,
      artifactsEnabled: true,
    });

    expect(turnResult.failure).toEqual({ source: 'model', code: 'authentication' });
    expect(turnResult.memory).toEqual({ changed: false });
  });

  it('returns the safe quota failure category and actionable summary to programmatic hosts', async () => {
    const storage = await createConversationTurnStorage();
    vi.spyOn(agentLoopModule.AgentLoopRuntimeService, 'run').mockResolvedValue(createLoopResult({
      workspaceRoot: storage.workspaceRoot,
      prompt: 'Use a credential without quota.',
      summary: 'LLM error: Model provider quota or billing limit reached',
      outcome: 'error',
      failure: { source: 'model', code: 'quota' },
    }) as never);

    const turnResult = await EngineConversationTurnService.run({
      workspaceRoot: storage.workspaceRoot,
      stateRoot: storage.stateRoot,
      traceDir: join(storage.stateRoot, 'traces'),
      sessionStoragePath: storage.sessionStoragePath,
      sessionId: storage.sessionId,
      prompt: 'Use a credential without quota.',
      apiKey: 'quota-exhausted-key',
      memoryMaintenanceMode: 'none',
      artifactRoot: storage.artifactRoot,
      artifactsEnabled: true,
    });

    expect(turnResult.failure).toEqual({ source: 'model', code: 'quota' });
    expect(turnResult.summary).toContain('no usable provider quota or billing capacity');
  });

  it('clears the session lease when the run loop fails', async () => {
    const storage = await createConversationTurnStorage();
    vi.spyOn(agentLoopModule.AgentLoopRuntimeService, 'run').mockRejectedValue(new Error('loop failed'));

    await expect(EngineConversationTurnService.run({
      workspaceRoot: storage.workspaceRoot,
      stateRoot: storage.stateRoot,
      sessionStoragePath: storage.sessionStoragePath,
      sessionId: storage.sessionId,
      prompt: 'Fail after preflight.',
      apiKey: 'explicit-key',
      memoryMaintenanceMode: 'none',
      artifactRoot: storage.artifactRoot,
      artifactsEnabled: true,
      leaseOwner: {
        ownerKind: 'daemon',
        hostId: 'test-host',
        ownerId: 'daemon-test',
        clientLabel: 'control plane',
      },
    })).rejects.toThrow('loop failed');

    const persisted = await readStoredChatSession(
      new FileChatSessionRepository({ sessionStoragePath: storage.sessionStoragePath }),
      storage.sessionId,
    );
    expect(persisted?.lease).toBeUndefined();
    expect(persisted?.turns).toEqual([]);
  });

  it('renews the fenced lease while a direct engine turn exceeds the stale window', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-03T00:00:00.000Z'));
    const storage = await createConversationTurnStorage();
    let finishLoop: (() => void) | undefined;
    let markLoopStarted: (() => void) | undefined;
    const loopStarted = new Promise<void>((resolve) => {
      markLoopStarted = resolve;
    });
    const originalRefreshLease = FileConversationSessionService.prototype.refreshLease;
    const refreshCompletions: Array<ReturnType<typeof originalRefreshLease>> = [];
    const refreshSpy = vi
      .spyOn(FileConversationSessionService.prototype, 'refreshLease')
      .mockImplementation(function (
        this: FileConversationSessionService,
        ...args: Parameters<typeof originalRefreshLease>
      ) {
        const completion = originalRefreshLease.apply(this, args);
        refreshCompletions.push(completion);
        return completion;
      });
    vi.spyOn(agentLoopModule.AgentLoopRuntimeService, 'run').mockImplementation(async () => {
      markLoopStarted?.();
      return await new Promise((resolve) => {
        finishLoop = () => resolve(createLoopResult({
          workspaceRoot: storage.workspaceRoot,
          prompt: 'Complete a long turn.',
          summary: 'Long turn completed.',
        }) as never);
      });
    });

    const turn = EngineConversationTurnService.run({
      workspaceRoot: storage.workspaceRoot,
      stateRoot: storage.stateRoot,
      traceDir: join(storage.stateRoot, 'traces'),
      sessionStoragePath: storage.sessionStoragePath,
      sessionId: storage.sessionId,
      prompt: 'Complete a long turn.',
      apiKey: 'explicit-key',
      memoryMaintenanceMode: 'none',
      artifactRoot: storage.artifactRoot,
      artifactsEnabled: true,
    });

    try {
      await loopStarted;
      const initiallyLeased = await readStoredChatSession(
        new FileChatSessionRepository({ sessionStoragePath: storage.sessionStoragePath }),
        storage.sessionId,
      );
      expect(initiallyLeased?.lease).toBeDefined();

      const refreshCount = (
        SESSION_LEASE_STALE_AFTER_MS + SESSION_LEASE_REFRESH_INTERVAL_MS
      ) / SESSION_LEASE_REFRESH_INTERVAL_MS;
      for (let refreshIndex = 0; refreshIndex < refreshCount; refreshIndex += 1) {
        await vi.advanceTimersByTimeAsync(SESSION_LEASE_REFRESH_INTERVAL_MS);
        expect(refreshSpy).toHaveBeenCalledTimes(refreshIndex + 1);
        await refreshCompletions[refreshIndex];
        await Promise.resolve();
      }

      const renewed = await readStoredChatSession(
        new FileChatSessionRepository({ sessionStoragePath: storage.sessionStoragePath }),
        storage.sessionId,
      );
      expect(renewed && ChatSessionLeases.isFresh(renewed)).toBe(true);
      expect(renewed?.lease?.lastSeenAt).not.toBe(initiallyLeased?.lease?.lastSeenAt);

      finishLoop?.();
      await expect(turn).resolves.toEqual(expect.objectContaining({
        outcome: 'done',
        summary: 'Long turn completed.',
      }));

      const persisted = await readStoredChatSession(
        new FileChatSessionRepository({ sessionStoragePath: storage.sessionStoragePath }),
        storage.sessionId,
      );
      expect(persisted?.lease).toBeUndefined();
      expect(persisted?.turns).toHaveLength(1);
    } finally {
      finishLoop?.();
      await turn.catch(() => undefined);
      vi.useRealTimers();
    }
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

async function createConversationTurnStorage() {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-conversation-turn-'));
  const stateRoot = join(workspaceRoot, '.heddle');
  const sessionStoragePath = join(stateRoot, 'chat-sessions.catalog.json');
  const session = ChatSessionRecords.create({
    id: 'session-1',
    name: 'Session 1',
    apiKeyPresent: true,
    model: 'gpt-5.4',
  });
  await new FileChatSessionRepository({ sessionStoragePath }).create(session);

  return {
    workspaceRoot,
    stateRoot,
    sessionStoragePath,
    sessionId: session.id,
    artifactRoot: join(stateRoot, 'artifacts'),
  };
}

function createLoopResult(args: {
  workspaceRoot: string;
  prompt: string;
  summary: string;
  outcome?: RunResult['outcome'];
  failure?: RunResult['failure'];
  trace?: RunResult['trace'];
}) {
  const outcome = args.outcome ?? 'done';
  const trace: RunResult['trace'] = args.trace ?? [
    {
      type: 'assistant.turn',
      content: args.summary,
      requestedTools: false,
      step: 1,
      timestamp: '2026-05-03T00:00:01.000Z',
    },
    {
      type: 'run.finished',
      outcome,
      summary: args.summary,
      ...(args.failure ? { failure: args.failure } : {}),
      step: 1,
      timestamp: '2026-05-03T00:00:02.000Z',
    },
  ];
  const transcript = [
    { role: 'user' as const, content: args.prompt },
    { role: 'assistant' as const, content: args.summary },
  ];

  return {
    outcome,
    summary: args.summary,
    ...(args.failure ? { failure: args.failure } : {}),
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
      outcome,
      summary: args.summary,
      ...(args.failure ? { failure: args.failure } : {}),
      transcript,
      trace,
    },
  };
}

function testAdapter(chat: LlmAdapter['chat']): LlmAdapter {
  return {
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
    chat,
  };
}

function rootAgentSnapshot(): CustomAgentExecutionSnapshot {
  return {
    agentProfileId: 'project:root-reviewer',
    agentName: 'Root reviewer',
    source: 'project',
    definitionHash: 'root-reviewer-definition',
    runtime: { maxSteps: 4 },
    toolProfile: {
      preset: 'inspect',
      memoryMode: 'none',
    },
    approvalProfile: { preset: 'read_only' },
    systemContextAppendix: 'ROOT_PROFILE_SENTINEL',
  };
}

async function rejectAdapterWhenAborted(signal: AbortSignal | undefined): Promise<LlmResponse> {
  if (!signal) {
    throw new Error('Expected delegated child abort signal');
  }
  if (signal.aborted) {
    throw Object.assign(new Error('cancelled'), { name: 'AbortError' });
  }

  return await new Promise<LlmResponse>((_resolve, reject) => {
    signal.addEventListener('abort', () => {
      reject(Object.assign(new Error('cancelled'), { name: 'AbortError' }));
    }, { once: true });
  });
}
