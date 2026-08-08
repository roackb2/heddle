import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConversationCompactionService } from '@/core/chat/engine/compaction/index.js';
import type { ConversationSessionService } from '@/core/chat/engine/types.js';
import { ChatArchiveRepositoryError } from '@/core/chat/engine/sessions/archives/index.js';
import type { ChatSessionLeaseClaim } from '@/core/chat/engine/sessions/leases/index.js';
import { ChatSessionRecords } from '@/core/chat/engine/sessions/records/index.js';
import { ConversationTurnContextRecoveryService } from '@/core/chat/engine/turns/recovery/index.js';
import type { ChatSession } from '@/core/chat/types.js';
import type { ChatMessage } from '@/core/llm/types.js';

const leaseClaim: ChatSessionLeaseClaim = {
  hostId: 'test-host',
  ownerId: 'test-owner',
  fencingToken: 1,
};

describe('ConversationTurnContextRecoveryService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('persists the rejected active transcript before replacing it with compacted history', async () => {
    const session = ChatSessionRecords.create({ id: 'session-1', name: 'Session' });
    const sessionHarness = createSessionHarness(session);
    const onCompactionStatus = vi.fn();
    const messages = activeMessages();
    const compactedHistory: ChatMessage[] = [
      { role: 'system', content: 'Archived conversation summary' },
      { role: 'assistant', content: 'Tool evidence remains available.' },
    ];
    vi.spyOn(ConversationCompactionService, 'compact').mockImplementation(async (options) => {
      expect(options.force).toBe(true);
      expect(options.history).toEqual(messages.slice(1));
      await options.onStatusChange?.({
        source: 'compaction',
        type: 'compaction.running',
        status: 'running',
      });
      await options.onStatusChange?.({
        source: 'compaction',
        type: 'compaction.finished',
        status: 'finished',
        archivePath: 'memory://session-1/archive-1.jsonl',
        summaryPath: 'memory://session-1/archive-1.summary.md',
      });
      return {
        history: compactedHistory,
        context: {
          estimatedHistoryTokens: 42,
          compaction: {
            compactedMessages: 4,
            compactedAt: '2026-08-08T00:00:00.000Z',
            status: 'idle',
          },
        },
        archive: {
          archives: [{
            id: 'archive-1',
            path: 'memory://session-1/archive-1.jsonl',
            summaryPath: 'memory://session-1/archive-1.summary.md',
            messageCount: 4,
            createdAt: '2026-08-08T00:00:00.000Z',
          }],
          currentSummaryPath: 'memory://session-1/archive-1.summary.md',
        },
      };
    });

    const recovered = await ConversationTurnContextRecoveryService.recover({
      messages,
      failure: { source: 'model', code: 'context_window' },
      sessionService: sessionHarness.service,
      sessionId: session.id,
      leaseClaim,
      model: 'gpt-5.6-sol',
      stateRoot: '/tmp/heddle-context-recovery-test',
      toolNames: ['list_files'],
      prompt: 'Inspect the repository.',
      summarizer: {},
      host: { onCompactionStatus },
    });

    expect(recovered).toEqual({
      messages: [messages[0], ...compactedHistory],
    });
    expect(sessionHarness.markCompactionRunning).toHaveBeenCalledWith(session.id, {
      sourceHistory: messages.slice(1),
      archivePath: undefined,
      leaseClaim,
    });
    expect(sessionHarness.updateWithLease).toHaveBeenCalledOnce();
    expect(sessionHarness.current().history).toEqual(compactedHistory);
    expect(onCompactionStatus).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'running' }),
      'recovery',
    );
    expect(onCompactionStatus).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'finished' }),
      'recovery',
    );
  });

  it('restores prior archive metadata when recovery archive persistence fails', async () => {
    const session = {
      ...ChatSessionRecords.create({ id: 'session-1', name: 'Session' }),
      context: { estimatedHistoryTokens: 12 },
      archives: [{
        id: 'archive-0',
        path: 'memory://session-1/archive-0.jsonl',
        summaryPath: 'memory://session-1/archive-0.summary.md',
        messageCount: 2,
        createdAt: '2026-08-07T00:00:00.000Z',
      }],
    };
    const sessionHarness = createSessionHarness(session);
    const messages = activeMessages();
    vi.spyOn(ConversationCompactionService, 'compact').mockImplementation(async (options) => {
      await options.onStatusChange?.({
        source: 'compaction',
        type: 'compaction.running',
        status: 'running',
      });
      throw new ChatArchiveRepositoryError('append', new Error('archive backend unavailable'));
    });

    await expect(ConversationTurnContextRecoveryService.recover({
      messages,
      failure: { source: 'model', code: 'context_window' },
      sessionService: sessionHarness.service,
      sessionId: session.id,
      leaseClaim,
      model: 'gpt-5.6-sol',
      stateRoot: '/tmp/heddle-context-recovery-test',
      toolNames: ['list_files'],
      prompt: 'Inspect the repository.',
      summarizer: {},
      host: {},
    })).rejects.toThrow('archive backend unavailable');

    expect(sessionHarness.restoreCompactionState).toHaveBeenCalledWith(session.id, {
      context: session.context,
      archives: session.archives,
      leaseClaim,
    });
    expect(sessionHarness.markCompactionRunning).toHaveBeenCalledWith(
      session.id,
      expect.objectContaining({ sourceHistory: messages.slice(1), leaseClaim }),
    );
  });
});

function activeMessages(): ChatMessage[] {
  return [
    { role: 'system', content: 'You are a repository agent.' },
    { role: 'user', content: 'Inspect the repository.' },
    {
      role: 'assistant',
      content: 'I will inspect it.',
      toolCalls: [{ id: 'call-1', tool: 'list_files', input: { path: '.' } }],
    },
    { role: 'tool', content: 'README.md\nsrc/', toolCallId: 'call-1' },
  ];
}

function createSessionHarness(initial: ChatSession) {
  let current = initial;
  const markCompactionRunning = vi.fn(async () => current);
  const restoreCompactionState = vi.fn(async () => current);
  const updateWithLease = vi.fn(async (
    _id: string,
    _claim: ChatSessionLeaseClaim,
    updater: (session: ChatSession) => ChatSession,
  ) => {
    current = updater(current);
    return current;
  });
  const service = {
    require: vi.fn(async () => current),
    markCompactionRunning,
    restoreCompactionState,
    updateWithLease,
  } as unknown as ConversationSessionService;

  return {
    service,
    markCompactionRunning,
    restoreCompactionState,
    updateWithLease,
    current: () => current,
  };
}
