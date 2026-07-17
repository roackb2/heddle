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
      leaseOwner: { ownerKind: 'daemon', ownerId: 'daemon-test' },
      host: {},
    })).rejects.toThrow('archive backend unavailable');

    const restored = await fixture.sessions.require(fixture.session.id);
    expect(restored.context).toEqual(fixture.session.context);
    expect(restored.archives).toEqual(fixture.session.archives);
    expect(restored.history).toEqual(fixture.session.history);
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
      credentialSource: { type: 'explicit-api-key' },
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
