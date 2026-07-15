import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConversationTurnArtifacts, ConversationTurnPersistenceService } from '../../../core/chat/engine/turns/persistence/index.js';
import { ConversationCompactionService } from '../../../core/chat/engine/compaction/index.js';
import { FileChatSessionRepository } from '../../../core/chat/engine/sessions/repository/index.js';
import { FileConversationSessionService } from '../../../core/chat/engine/sessions/service.js';
import { readStoredChatSession, seedChatSessionRepository } from '@/__tests__/helpers/chat-session-repository.js';
import { TraceSummaryService } from '@/core/observability/index.js';
import type { AgentLoopResult } from '@/core/runtime/loop/index.js';
import type { ChatSession } from '../../../core/chat/types.js';
import type { CustomAgentExecutionSnapshot } from '../../../core/custom-agents/index.js';
import type { RunResult } from '../../../core/types.js';

describe('chat turn persistence', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses a supplied trace summarizer registry for persisted turn events', async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), 'heddle-turn-persistence-'));
    const session = createSession();
    const result: RunResult = {
      outcome: 'done',
      summary: 'Done.',
      trace: [
        {
          type: 'tool.calling',
          call: { id: 'call-1', tool: 'read_file', input: { path: 'README.md' } },
          requiresApproval: false,
          step: 1,
          timestamp: '2026-05-02T00:00:00.000Z',
        },
      ],
      transcript: [
        { role: 'user', content: 'Read README.' },
        { role: 'assistant', content: 'Done.' },
      ],
    };

    const artifacts = await ConversationTurnArtifacts.build({
      result,
      prompt: 'Read README.',
      session,
      model: 'gpt-5.4',
      stateRoot,
      traceDir: join(stateRoot, 'traces'),
      toolNames: ['read_file'],
      historyForTokenEstimate: session.history,
      summarizer: {},
      traceSummarizerRegistry: new TraceSummaryService({
        'tool.calling': (event) => `custom summary for ${event.call.tool}`,
      }),
      createTurnId: () => 'turn-1',
    });

    expect(artifacts.turn.events).toEqual(['custom summary for read_file']);
  });

  it('forces final compaction after context-window overload failures', async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), 'heddle-turn-persistence-context-overload-'));
    const session = createSession();
    const result: RunResult = {
      outcome: 'error',
      summary: 'Your input exceeds the context window of this model. Please adjust your input and try again.',
      trace: [],
      transcript: [
        { role: 'user', content: 'Large prompt' },
        { role: 'assistant', content: 'Large prior response' },
        { role: 'user', content: 'Retry' },
      ],
    };
    const compact = vi.spyOn(ConversationCompactionService, 'compact').mockResolvedValueOnce({
      history: result.transcript,
      context: {
        estimatedHistoryTokens: 3,
      },
      archive: {
        archives: [],
      },
    });

    const artifacts = await ConversationTurnArtifacts.build({
      result,
      prompt: 'Retry',
      session,
      model: 'gpt-5.5',
      stateRoot,
      traceDir: join(stateRoot, 'traces'),
      toolNames: [],
      historyForTokenEstimate: result.transcript,
      summarizer: {},
      createTurnId: () => 'turn-1',
    });

    expect(compact).toHaveBeenCalledWith(expect.objectContaining({
      force: true,
      history: result.transcript,
    }));
    expect(artifacts.summary).toContain('automatically compact earlier history');
  });

  it('persists the completed turn back to session storage', async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), 'heddle-turn-persistence-save-'));
    const sessionStoragePath = join(stateRoot, 'chat-sessions.catalog.json');
    const session = createSession();
    const repository = new FileChatSessionRepository({ sessionStoragePath });
    await seedChatSessionRepository(repository, [session]);
    const sessionService = createSessionService(stateRoot, sessionStoragePath, repository);

    const result: AgentLoopResult = {
      outcome: 'done',
      summary: 'Done.',
      trace: [
        {
          type: 'run.finished',
          outcome: 'done',
          summary: 'Done.',
          step: 1,
          timestamp: '2026-05-02T00:00:00.000Z',
        },
      ],
      transcript: [
        { role: 'user', content: 'Persist this turn.' },
        { role: 'assistant', content: 'Done.' },
      ],
      model: 'gpt-5.4',
      provider: 'openai',
      workspaceRoot: stateRoot,
      state: {
        status: 'finished',
        runId: 'run-test',
        goal: 'Persist this turn.',
        model: 'gpt-5.4',
        provider: 'openai',
        workspaceRoot: stateRoot,
        startedAt: '2026-05-02T00:00:00.000Z',
        finishedAt: '2026-05-02T00:00:01.000Z',
        outcome: 'done',
        summary: 'Done.',
        transcript: [
          { role: 'user', content: 'Persist this turn.' },
          { role: 'assistant', content: 'Done.' },
        ],
        trace: [
          {
            type: 'run.finished',
            outcome: 'done',
            summary: 'Done.',
            step: 1,
            timestamp: '2026-05-02T00:00:00.000Z',
          },
        ],
      },
    };

    const persisted = await ConversationTurnPersistenceService.persistCompleted({
      result,
      prompt: 'Persist this turn.',
      session,
      sessionService,
      model: 'gpt-5.4',
      stateRoot,
      traceDir: join(stateRoot, 'traces'),
      toolNames: ['read_file'],
      historyForTokenEstimate: session.history,
      credentialSource: { type: 'explicit-api-key' },
      host: {},
    });

    const stored = await readStoredChatSession(repository, session.id);
    expect(stored?.id).toBe(session.id);
    expect(stored?.lastContinuePrompt).toBe('Persist this turn.');
    expect(stored?.messages.map((message) => message.text)).toEqual(['Persist this turn.', 'Done.']);
    expect(stored?.turns).toHaveLength(1);
    expect(stored?.turns[0]?.traceFile).toBe(persisted.traceFile);
    expect(stored?.lease).toBeUndefined();
  });

  it('persists the selected custom-agent snapshot with the completed turn', async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), 'heddle-turn-persistence-agent-'));
    const sessionStoragePath = join(stateRoot, 'chat-sessions.catalog.json');
    const session = createSession();
    const agentSnapshot = askAgentSnapshot();
    const repository = new FileChatSessionRepository({ sessionStoragePath });
    await seedChatSessionRepository(repository, [session]);

    const result: AgentLoopResult = {
      outcome: 'done',
      summary: 'Done.',
      trace: [],
      transcript: [
        { role: 'user', content: 'Explain this repository.' },
        { role: 'assistant', content: 'Done.' },
      ],
      model: 'gpt-5.4',
      provider: 'openai',
      workspaceRoot: stateRoot,
    };

    await ConversationTurnPersistenceService.persistCompleted({
      result,
      prompt: 'Explain this repository.',
      session,
      sessionService: createSessionService(stateRoot, sessionStoragePath, repository),
      model: 'gpt-5.4',
      stateRoot,
      traceDir: join(stateRoot, 'traces'),
      toolNames: ['read_file'],
      historyForTokenEstimate: session.history,
      credentialSource: { type: 'explicit-api-key' },
      agentSnapshot,
      host: {},
    });

    const stored = await readStoredChatSession(repository, session.id);
    expect(stored?.turns[0]?.agent).toEqual({
      id: 'builtin:ask',
      name: 'Ask',
      modeAlias: 'ask',
      source: 'built-in',
      definitionHash: 'askhash',
    });
    expect(stored?.turns[0]?.agentSnapshot).toEqual(agentSnapshot);
  });

  it('normalizes an accepted user message without duplicating it after completion', async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), 'heddle-turn-persistence-accepted-'));
    const sessionStoragePath = join(stateRoot, 'chat-sessions.catalog.json');
    const session = {
      ...createSession(),
      messages: [
        {
          id: 'accepted-user-run-1',
          role: 'user' as const,
          text: 'Persist this accepted prompt.',
          isPending: true,
        },
      ],
    };
    const repository = new FileChatSessionRepository({ sessionStoragePath });
    await seedChatSessionRepository(repository, [session]);

    const result: AgentLoopResult = {
      outcome: 'done',
      summary: 'Done.',
      trace: [],
      transcript: [
        { role: 'user', content: 'Persist this accepted prompt.' },
        { role: 'assistant', content: 'Done.' },
      ],
      model: 'gpt-5.4',
      provider: 'openai',
      workspaceRoot: stateRoot,
    };

    await ConversationTurnPersistenceService.persistCompleted({
      result,
      prompt: 'Persist this accepted prompt.',
      session,
      sessionService: createSessionService(stateRoot, sessionStoragePath, repository),
      model: 'gpt-5.4',
      stateRoot,
      traceDir: join(stateRoot, 'traces'),
      toolNames: [],
      historyForTokenEstimate: session.history,
      credentialSource: { type: 'explicit-api-key' },
      host: {},
    });

    const stored = await readStoredChatSession(repository, session.id);
    expect(stored?.messages).toEqual([
      expect.objectContaining({
        role: 'user',
        text: 'Persist this accepted prompt.',
      }),
      expect.objectContaining({
        role: 'assistant',
        text: 'Done.',
      }),
    ]);
    expect(stored?.messages[0]).not.toHaveProperty('isPending');
  });
});

function createSessionService(
  stateRoot: string,
  sessionStoragePath: string,
  sessionRepository: FileChatSessionRepository,
): FileConversationSessionService {
  return new FileConversationSessionService({
    workspaceRoot: stateRoot,
    stateRoot,
    sessionStoragePath,
    sessionRepository,
    model: 'gpt-5.4',
  });
}

function createSession(): ChatSession {
  return {
    id: 'session-1',
    name: 'Session',
    history: [],
    messages: [],
    turns: [],
    createdAt: '2026-05-02T00:00:00.000Z',
    updatedAt: '2026-05-02T00:00:00.000Z',
  };
}

function askAgentSnapshot(): CustomAgentExecutionSnapshot {
  return {
    agentProfileId: 'builtin:ask',
    agentName: 'Ask',
    modeAlias: 'ask',
    source: 'built-in',
    definitionHash: 'askhash',
    runtime: { maxSteps: 60 },
    toolProfile: {
      preset: 'inspect',
      includeTools: ['read_file', 'search_files', 'run_shell_inspect'],
      memoryMode: 'none',
    },
    approvalProfile: { preset: 'read_only' },
    systemContextAppendix: 'You are running in ask mode.',
  };
}
