import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ConversationCompactionService } from '@/core/chat/engine/compaction/index.js';
import {
  ChatArchivePersistenceCodec,
  ChatArchiveRepositoryError,
  ChatArchiveSummaryNotFoundError,
  FileChatArchiveRepository,
  type AppendChatArchiveInput,
  type AppendChatArchiveResult,
  type ChatArchiveRepository,
} from '@/core/chat/engine/sessions/archives/index.js';
import type { ChatArchiveManifest } from '@/core/chat/types.js';
import type { ChatMessage, LlmAdapter } from '@/core/llm/types.js';

describe('conversation compaction archive repository', () => {
  it('preserves the zero-configuration local archive layout', async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), 'heddle-local-archive-compaction-'));

    const compacted = await ConversationCompactionService.compact({
      history: history('local'),
      runtime: { model: 'gpt-5.4', stateRoot },
      session: { id: 'session-1' },
      force: true,
      summarizer: {
        model: 'gpt-5.4',
        llm: { chat: async () => ({ content: 'Local rolling summary' }) },
      },
    });

    const manifest = await new FileChatArchiveRepository({ stateRoot }).loadManifest('session-1');
    expect(manifest).toEqual(expect.objectContaining({
      archives: compacted.archive.archives,
      currentSummaryPath: compacted.archive.currentSummaryPath,
    }));
    expect(manifest.archives[0]?.path).toMatch(
      /^\.heddle\/chat-sessions\/session-1\/archives\/archive-/,
    );
  });

  it('continues a rolling summary from a fresh repository instance without shared archive files', async () => {
    const backend = new InMemoryArchiveBackend();
    const stateRoot = await mkdtemp(join(tmpdir(), 'heddle-remote-archive-compaction-'));
    const prompts: ChatMessage[][] = [];
    const summaries = ['First durable rolling summary', 'Second durable rolling summary'];
    const llm: LlmAdapter = {
      chat: vi.fn(async (messages) => {
        prompts.push(messages);
        return { content: summaries[prompts.length - 1] };
      }),
    };

    const first = await ConversationCompactionService.compact({
      history: history('first'),
      runtime: { model: 'gpt-5.4', stateRoot },
      session: { id: 'session-1' },
      archiveRepository: backend.createRepository(),
      force: true,
      summarizer: { llm, model: 'gpt-5.4' },
    });
    const second = await ConversationCompactionService.compact({
      history: [
        ...first.history,
        { role: 'user', content: 'second user 1' },
        { role: 'assistant', content: 'second assistant 1' },
        { role: 'user', content: 'second user 2' },
        { role: 'assistant', content: 'second assistant 2' },
      ],
      runtime: { model: 'gpt-5.4', stateRoot },
      session: { id: 'session-1' },
      archiveRepository: backend.createRepository(),
      force: true,
      summarizer: { llm, model: 'gpt-5.4' },
    });

    expect(first.archive.archives).toHaveLength(1);
    expect(second.archive.archives).toHaveLength(2);
    expect(second.archive.currentSummaryPath).toMatch(/^memory:\/\/session-1\//);
    expect(prompts[1]?.find((message) => message.role === 'user')?.content)
      .toContain('First durable rolling summary');
    expect(second.history[0]).toEqual(expect.objectContaining({
      role: 'system',
      content: expect.stringContaining('Second durable rolling summary'),
    }));
  });

  it('rejects archive infrastructure failures after emitting a failed status', async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), 'heddle-archive-failure-'));
    const statuses: string[] = [];
    const repository: ChatArchiveRepository = {
      loadManifest: async (sessionId) => ChatArchivePersistenceCodec.emptyManifest(sessionId),
      readSummary: async () => undefined,
      append: async () => {
        throw new Error('archive backend unavailable');
      },
    };

    await expect(ConversationCompactionService.compact({
      history: history('failure'),
      runtime: { model: 'gpt-5.4', stateRoot },
      session: { id: 'session-1' },
      archiveRepository: repository,
      force: true,
      summarizer: {
        model: 'gpt-5.4',
        llm: { chat: async () => ({ content: 'Summary completed before storage failed' }) },
      },
      onStatusChange: (event) => {
        statuses.push(event.status);
      },
    })).rejects.toThrow('archive backend unavailable');

    expect(statuses).toEqual(['running', 'failed']);
  });

  it('rejects a manifest whose current summary locator cannot be reconstructed', async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), 'heddle-archive-missing-summary-'));
    const repository: ChatArchiveRepository = {
      loadManifest: async () => ({
        version: 1,
        sessionId: 'session-1',
        currentSummaryPath: 'remote://archive-1/summary',
        archives: [{
          id: 'archive-1',
          path: 'remote://archive-1/messages',
          summaryPath: 'remote://archive-1/summary',
          messageCount: 2,
          createdAt: '2026-07-17T00:00:00.000Z',
        }],
      }),
      readSummary: async () => undefined,
      append: async () => {
        throw new Error('append should not run');
      },
    };

    const pending = ConversationCompactionService.compact({
      history: history('missing'),
      runtime: { model: 'gpt-5.4', stateRoot },
      session: { id: 'session-1' },
      archiveRepository: repository,
      force: true,
      summarizer: {
        model: 'gpt-5.4',
        llm: { chat: async () => ({ content: 'Must not run' }) },
      },
    });

    await expect(pending).rejects.toMatchObject({
      operation: 'read_summary',
      cause: expect.any(ChatArchiveSummaryNotFoundError),
    } satisfies Partial<ChatArchiveRepositoryError>);
  });
});

type InMemoryArchiveState = {
  manifest: ChatArchiveManifest;
  summaries: Map<string, string>;
};

class InMemoryArchiveBackend {
  private readonly sessions = new Map<string, InMemoryArchiveState>();

  createRepository(): ChatArchiveRepository {
    return {
      loadManifest: async (sessionId) => structuredClone(this.readState(sessionId).manifest),
      readSummary: async (summaryLocator) => {
        for (const state of this.sessions.values()) {
          const summary = state.summaries.get(summaryLocator);
          if (summary !== undefined) {
            return summary;
          }
        }
        return undefined;
      },
      append: async (input) => this.append(input),
    };
  }

  private append(input: AppendChatArchiveInput): AppendChatArchiveResult {
    const state = this.readState(input.sessionId);
    const archive = {
      ...input.archive,
      path: `memory://${input.sessionId}/${input.archive.id}.jsonl`,
      summaryPath: `memory://${input.sessionId}/${input.archive.id}.summary.md`,
    };
    const manifest = ChatArchivePersistenceCodec.appendArchive(state.manifest, archive);
    state.manifest = manifest;
    state.summaries.set(archive.summaryPath, input.summary);
    return structuredClone({ archive, manifest });
  }

  private readState(sessionId: string): InMemoryArchiveState {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      return existing;
    }

    const created = {
      manifest: ChatArchivePersistenceCodec.emptyManifest(sessionId),
      summaries: new Map<string, string>(),
    };
    this.sessions.set(sessionId, created);
    return created;
  }
}

function history(prefix: string): ChatMessage[] {
  return [
    { role: 'user', content: `${prefix} user 1` },
    { role: 'assistant', content: `${prefix} assistant 1` },
    { role: 'user', content: `${prefix} user 2` },
    { role: 'assistant', content: `${prefix} assistant 2` },
    { role: 'user', content: `${prefix} user 3` },
    { role: 'assistant', content: `${prefix} assistant 3` },
  ];
}
