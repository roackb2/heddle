import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConversationCompactionService } from '@/core/chat/engine/compaction/index.js';
import { ChatArchiveRepositoryError } from '@/core/chat/engine/sessions/archives/index.js';
import { ChatSessionRecords } from '@/core/chat/engine/sessions/records/index.js';
import { FileChatSessionRepository } from '@/core/chat/engine/sessions/repository/index.js';
import { FileConversationSessionService } from '@/core/chat/engine/sessions/service.js';
import { ConversationTurnPreflightService } from '@/core/chat/engine/turns/preflight/index.js';
import { ConversationTurnPersistenceService } from '@/core/chat/engine/turns/persistence/index.js';
import { ModelCatalogService } from '@/core/llm/models/index.js';
import type { AgentLoopResult } from '@/core/runtime/loop/index.js';

describe('compaction infrastructure failure restoration', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('restores preflight compaction metadata after an archive backend exception', async () => {
    const fixture = await createFixture('preflight');
    failCompactionAfterRunning();

    await expect(ConversationTurnPreflightService.prepare({
      sessionService: fixture.sessions,
      sessionId: fixture.session.id,
      fallbackHistory: fixture.session.history,
      prompt: 'Continue the investigation',
      model: 'gpt-5.4',
      stateRoot: fixture.stateRoot,
      toolNames: [],
      summarizer: {},
      leaseOwner: { ownerKind: 'daemon', hostId: 'test-host', ownerId: 'daemon-test' },
      host: {},
    })).rejects.toThrow('archive backend unavailable');

    const restored = await fixture.sessions.require(fixture.session.id);
    expect(restored.context).toEqual(fixture.session.context);
    expect(restored.archives).toEqual(fixture.session.archives);
    expect(restored.history).toEqual(fixture.session.history);
  });

  it('stops preflight before the model request when compaction fails', async () => {
    const fixture = await createFixture('preflight-failed-result');
    vi.spyOn(ConversationCompactionService, 'compact').mockImplementation(async (options) => {
      await options.onStatusChange?.({
        source: 'compaction',
        type: 'compaction.failed',
        status: 'failed',
        error: 'summarizer unavailable',
      });
      return {
        history: options.history,
        context: {
          estimatedHistoryTokens: 12,
          request: { estimatedTokens: 40 },
          compaction: { status: 'failed', error: 'summarizer unavailable' },
        },
        archive: {
          archives: fixture.session.archives,
          currentSummaryPath: fixture.session.context.archive?.currentSummaryPath,
        },
      };
    });

    const result = await ConversationTurnPreflightService.prepare({
      sessionService: fixture.sessions,
      sessionId: fixture.session.id,
      fallbackHistory: fixture.session.history,
      prompt: 'Continue the investigation',
      model: 'gpt-5.4',
      stateRoot: fixture.stateRoot,
      toolNames: [],
      summarizer: {},
      leaseOwner: { ownerKind: 'daemon', hostId: 'test-host', ownerId: 'daemon-test' },
      host: {},
    });

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      reason: 'compaction_failed',
      message: expect.stringContaining('summarizer unavailable'),
    }));
    expect((await fixture.sessions.require(fixture.session.id)).context.compaction).toEqual(
      expect.objectContaining({ status: 'failed', error: expect.stringContaining('summarizer unavailable') }),
    );
  });

  it('stops preflight when compaction leaves a request larger than the model window', async () => {
    const fixture = await createFixture('preflight-request-too-large');
    const onCompactionStatus = vi.fn();
    vi.spyOn(ModelCatalogService, 'estimateBuiltInContextWindow').mockReturnValue(100);
    vi.spyOn(ConversationCompactionService, 'compact').mockResolvedValue({
      history: fixture.session.history,
      context: {
        estimatedHistoryTokens: 12,
        request: { estimatedTokens: 300 },
        compaction: { status: 'idle' },
      },
      archive: {
        archives: fixture.session.archives,
        currentSummaryPath: fixture.session.context.archive?.currentSummaryPath,
      },
    });

    const result = await ConversationTurnPreflightService.prepare({
      sessionService: fixture.sessions,
      sessionId: fixture.session.id,
      fallbackHistory: fixture.session.history,
      prompt: 'x'.repeat(1_000),
      model: 'gpt-5.4',
      stateRoot: fixture.stateRoot,
      toolNames: [],
      summarizer: {},
      leaseOwner: { ownerKind: 'daemon', hostId: 'test-host', ownerId: 'daemon-test' },
      host: { onCompactionStatus },
    });

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      reason: 'request_too_large',
      message: expect.stringContaining('model context window'),
    }));
    expect(onCompactionStatus).toHaveBeenCalledWith(expect.objectContaining({
      type: 'compaction.failed',
      status: 'failed',
      error: expect.stringContaining('estimated request'),
    }), 'preflight');
    expect((await fixture.sessions.require(fixture.session.id)).context.compaction).toEqual(
      expect.objectContaining({ status: 'failed', error: expect.stringContaining('estimated request') }),
    );
  });

  it('allows a near-limit request because the provider remains authoritative', async () => {
    const fixture = await createFixture('preflight-near-limit');
    vi.spyOn(ConversationCompactionService, 'compact').mockResolvedValue({
      history: fixture.session.history,
      context: {
        estimatedHistoryTokens: 12,
        request: { estimatedTokens: 90 },
        compaction: { status: 'idle' },
      },
      archive: {
        archives: fixture.session.archives,
        currentSummaryPath: fixture.session.context.archive?.currentSummaryPath,
      },
    });
    vi.spyOn(ConversationCompactionService, 'assessRequest').mockReturnValue({
      contextWindowTokens: 100,
      estimatedRequestTokens: 90,
      compactionThresholdTokens: 85,
      exceedsCompactionThreshold: true,
      exceedsContextWindow: false,
    });

    const result = await ConversationTurnPreflightService.prepare({
      sessionService: fixture.sessions,
      sessionId: fixture.session.id,
      fallbackHistory: fixture.session.history,
      prompt: 'Continue the investigation',
      model: 'gpt-5.4',
      stateRoot: fixture.stateRoot,
      toolNames: [],
      summarizer: {},
      leaseOwner: { ownerKind: 'daemon', hostId: 'test-host', ownerId: 'daemon-test' },
      host: {},
    });

    expect(result.ok).toBe(true);
  });

  it('keeps the exact completed transcript but restores prior archive metadata after a final append failure', async () => {
    const fixture = await createFixture('final');
    failCompactionAfterRunning();
    const result = completedResult(fixture.stateRoot);

    await expect(ConversationTurnPersistenceService.persistCompleted({
      result,
      prompt: 'Continue the investigation',
      session: fixture.session,
      sessionService: fixture.sessions,
      model: 'gpt-5.4',
      stateRoot: fixture.stateRoot,
      traceDir: join(fixture.stateRoot, 'traces'),
      toolNames: [],
      historyForTokenEstimate: fixture.session.history,
      summarizer: { credentialSource: { type: 'explicit-api-key' } },
      host: {},
    })).rejects.toThrow('archive backend unavailable');

    const restored = await fixture.sessions.require(fixture.session.id);
    expect(restored.context).toEqual(fixture.session.context);
    expect(restored.archives).toEqual(fixture.session.archives);
    expect(restored.history).toEqual(result.transcript);
  });
});

function failCompactionAfterRunning(): void {
  vi.spyOn(ConversationCompactionService, 'compact').mockImplementation(async (options) => {
    await options.onStatusChange?.({
      source: 'compaction',
      type: 'compaction.running',
      status: 'running',
    });
    throw new ChatArchiveRepositoryError('append', new Error('archive backend unavailable'));
  });
}

async function createFixture(suffix: string) {
  const stateRoot = await mkdtemp(join(tmpdir(), `heddle-compaction-restore-${suffix}-`));
  const sessionStoragePath = join(stateRoot, 'chat-sessions.catalog.json');
  const repository = new FileChatSessionRepository({ sessionStoragePath });
  const session = {
    ...ChatSessionRecords.create({ id: 'session-1', name: 'Session' }),
    history: [
      { role: 'user' as const, content: 'Inspect the repository.' },
      { role: 'assistant' as const, content: 'Inspection started.' },
    ],
    context: {
      estimatedHistoryTokens: 12,
      compaction: { status: 'idle' as const },
      archive: { currentSummaryPath: 'memory://session-1/archive-1.summary.md' },
    },
    archives: [{
      id: 'archive-1',
      path: 'memory://session-1/archive-1.jsonl',
      summaryPath: 'memory://session-1/archive-1.summary.md',
      messageCount: 2,
      createdAt: '2026-07-17T00:00:00.000Z',
    }],
  };
  await repository.create(session);
  return {
    stateRoot,
    session,
    sessions: new FileConversationSessionService({
      workspaceRoot: stateRoot,
      stateRoot,
      sessionStoragePath,
      sessionRepository: repository,
      model: 'gpt-5.4',
    }),
  };
}

function completedResult(stateRoot: string): AgentLoopResult {
  return {
    outcome: 'done',
    summary: 'Investigation complete.',
    trace: [],
    transcript: [
      { role: 'user', content: 'Inspect the repository.' },
      { role: 'assistant', content: 'Inspection started.' },
      { role: 'user', content: 'Continue the investigation' },
      { role: 'assistant', content: 'Investigation complete.' },
    ],
    model: 'gpt-5.4',
    provider: 'openai',
    workspaceRoot: stateRoot,
  };
}
