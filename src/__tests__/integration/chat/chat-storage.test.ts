import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ChatSessionRecords } from '../../../core/chat/engine/sessions/records/index.js';
import {
  ChatSessionRevisionConflictError,
  FileChatSessionRepository,
} from '../../../core/chat/engine/sessions/repository/index.js';

describe('chat session storage layout', () => {
  it('writes catalog metadata separately from immutable session revisions', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'heddle-chat-storage-'));
    const sessionsFile = join(dir, 'chat-sessions.catalog.json');
    const session = {
      ...ChatSessionRecords.create({
        id: 'session-1',
        name: 'Session 1',
        workspaceId: 'workspace-1',
      }),
      pinned: true,
      archivedAt: '2026-04-13T02:00:00.000Z',
      model: 'gpt-5.1-codex-mini',
      reasoningEffort: 'high' as const,
      lastContinuePrompt: 'continue',
      context: { estimatedHistoryTokens: 42 },
      messages: [{ id: 'm1', role: 'assistant' as const, text: 'hello there' }],
      turns: [{
        id: 't1',
        prompt: 'hi',
        outcome: 'done' as const,
        summary: 'said hello',
        steps: 1,
        traceFile: '/tmp/trace-1.json',
        events: ['said hello'],
      }],
    };
    const repository = new FileChatSessionRepository({ sessionStoragePath: sessionsFile });

    const stored = await repository.create(session);
    const catalog = JSON.parse(readFileSync(sessionsFile, 'utf8')) as {
      version: number;
      sessions: Array<Record<string, unknown>>;
    };
    const body = JSON.parse(readFileSync(join(dir, 'chat-sessions', 'session-1.1.json'), 'utf8')) as Record<string, unknown>;
    const reread = (await repository.read('session-1'))?.session;

    expect(stored.revision).toBe(1);
    expect(catalog.version).toBe(1);
    expect(catalog.sessions[0]).toEqual(expect.objectContaining({
      id: 'session-1',
      revision: 1,
      name: 'Session 1',
      workspaceId: 'workspace-1',
      pinned: true,
      archivedAt: '2026-04-13T02:00:00.000Z',
      model: 'gpt-5.1-codex-mini',
      reasoningEffort: 'high',
      lastContinuePrompt: 'continue',
      context: { estimatedHistoryTokens: 42 },
    }));
    expect(catalog.sessions[0]?.messages).toBeUndefined();
    expect(body).toEqual(expect.objectContaining({
      id: 'session-1',
      messages: [{ id: 'm1', role: 'assistant', text: 'hello there' }],
    }));
    expect(reread).toEqual(expect.objectContaining({
      id: 'session-1',
      workspaceId: 'workspace-1',
      pinned: true,
      archivedAt: '2026-04-13T02:00:00.000Z',
      history: [],
      turns: [expect.objectContaining({ id: 't1', summary: 'said hello' })],
    }));
    expect(reread).not.toHaveProperty('revision');
  });

  it('uses expected revisions to prevent lost updates across repository instances', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'heddle-chat-storage-revision-'));
    const sessionsFile = join(dir, 'chat-sessions.catalog.json');
    const first = new FileChatSessionRepository({ sessionStoragePath: sessionsFile });
    const second = new FileChatSessionRepository({ sessionStoragePath: sessionsFile });
    const created = await first.create(ChatSessionRecords.create({ id: 'session-1', name: 'Session 1' }));
    const stale = await second.read('session-1');

    const updated = await first.update({
      session: { ...created.session, name: 'First writer' },
      expectedRevision: created.revision,
    });

    await expect(second.update({
      session: { ...stale!.session, name: 'Stale writer' },
      expectedRevision: stale!.revision,
    })).rejects.toBeInstanceOf(ChatSessionRevisionConflictError);
    expect(updated?.revision).toBe(2);
    expect(readFileSync(join(dir, 'chat-sessions', 'session-1.1.json'), 'utf8')).toContain('"id": "session-1"');
    expect(readFileSync(join(dir, 'chat-sessions', 'session-1.2.json'), 'utf8')).toContain('"id": "session-1"');
    expect((await second.read('session-1'))?.session.name).toBe('First writer');
  });

  it('paginates in the same deterministic order used by its cursor', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'heddle-chat-storage-pagination-'));
    const repository = new FileChatSessionRepository({
      sessionStoragePath: join(dir, 'chat-sessions.catalog.json'),
    });
    const sessions = [
      { ...ChatSessionRecords.create({ id: 'Z', name: 'Pinned Z' }), pinned: true, updatedAt: '2026-04-13T02:00:00.000Z' },
      { ...ChatSessionRecords.create({ id: 'a', name: 'Pinned a' }), pinned: true, updatedAt: '2026-04-13T02:00:00.000Z' },
      { ...ChatSessionRecords.create({ id: 'regular', name: 'Regular' }), updatedAt: '2026-04-13T03:00:00.000Z' },
    ];
    for (const session of sessions) {
      await repository.create(session);
    }

    const firstPage = await repository.list({ limit: 2 });
    const secondPage = await repository.list({ limit: 2, cursor: firstPage.nextCursor });

    expect(firstPage.items.map((entry) => entry.id)).toEqual(['Z', 'a']);
    expect(secondPage.items.map((entry) => entry.id)).toEqual(['regular']);
    expect(secondPage.nextCursor).toBeUndefined();
  });

  it('filters catalog pages by workspace and archive state', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'heddle-chat-storage-filters-'));
    const repository = new FileChatSessionRepository({
      sessionStoragePath: join(dir, 'chat-sessions.catalog.json'),
    });
    await repository.create(ChatSessionRecords.create({ id: 'active-a', name: 'Active A', workspaceId: 'workspace-a' }));
    await repository.create({
      ...ChatSessionRecords.create({ id: 'archived-a', name: 'Archived A', workspaceId: 'workspace-a' }),
      archivedAt: '2026-04-13T00:00:00.000Z',
    });
    await repository.create(ChatSessionRecords.create({ id: 'active-b', name: 'Active B', workspaceId: 'workspace-b' }));

    await expect(repository.list({
      limit: 10,
      workspaceId: 'workspace-a',
      archived: false,
    })).resolves.toMatchObject({ items: [expect.objectContaining({ id: 'active-a' })] });
    await expect(repository.list({
      limit: 10,
      workspaceId: 'workspace-a',
      archived: true,
    })).resolves.toMatchObject({ items: [expect.objectContaining({ id: 'archived-a' })] });
  });

  it('reads legacy revision-one bodies and normalizes optional disk fields', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'heddle-chat-storage-legacy-'));
    const sessionsFile = join(dir, 'chat-sessions.catalog.json');
    writeFileSync(sessionsFile, JSON.stringify({
      version: 1,
      sessions: [{
        id: 'session-1',
        name: 'Session 1',
        createdAt: '2026-04-13T00:00:00.000Z',
        updatedAt: '2026-04-13T01:00:00.000Z',
        context: { estimatedHistoryTokens: 'bad-token-count' },
        archives: [{ id: 'archive-1', path: '/tmp/archive.md' }],
      }],
    }, null, 2));
    const sessionsDir = join(dir, 'chat-sessions');
    mkdirSync(sessionsDir);
    writeFileSync(join(sessionsDir, 'session-1.json'), JSON.stringify({
      id: 'session-1',
      history: [
        { role: 'user', content: 'valid prompt' },
        { role: 'assistant', content: 42 },
      ],
      messages: [
        { id: 'intro', role: 'assistant', text: 'Heddle conversational mode.' },
        { id: 'm1', role: 'assistant', text: 'valid visible message' },
        { id: 'm2', role: 'system', text: 'invalid visible message' },
      ],
      turns: [{
        id: 't1',
        prompt: 'valid prompt',
        outcome: 'done',
        summary: 'valid turn',
        steps: 1,
        traceFile: '/tmp/trace-1.json',
        events: ['done'],
      }],
    }, null, 2));

    const stored = await new FileChatSessionRepository({ sessionStoragePath: sessionsFile }).read('session-1');

    expect(stored).toEqual({
      revision: 1,
      session: expect.objectContaining({
        id: 'session-1',
        context: undefined,
        archives: [],
        pinned: false,
        history: [{ role: 'user', content: 'valid prompt' }],
        messages: [{ id: 'm1', role: 'assistant', text: 'valid visible message' }],
        turns: [expect.objectContaining({ id: 't1', summary: 'valid turn' })],
      }),
    });
  });

  it('rejects invalid page sizes and preserves custom catalog filenames', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'heddle-chat-storage-custom-catalog-'));
    const configuredCatalogPath = join(dir, 'embedded-sessions.catalog.json');
    const repository = new FileChatSessionRepository({ sessionStoragePath: configuredCatalogPath });

    await expect(repository.list({ limit: 0 })).rejects.toThrow('between 1 and 200');
    expect(FileChatSessionRepository.deriveStoragePaths(configuredCatalogPath)).toEqual({
      catalogPath: configuredCatalogPath,
      sessionsDir: join(dir, 'embedded-sessions'),
    });
  });
});
