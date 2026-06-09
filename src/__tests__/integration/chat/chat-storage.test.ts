import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ChatSessionRecords } from '../../../core/chat/engine/sessions/records/index.js';
import { FileChatSessionRepository } from '../../../core/chat/engine/sessions/repository/index.js';

describe('chat session storage layout', () => {
  it('writes catalog metadata separately from per-session transcript bodies', () => {
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
      reasoningEffort: 'high',
      lastContinuePrompt: 'continue',
      context: { estimatedHistoryTokens: 42 },
      messages: [{ id: 'm1', role: 'assistant' as const, text: 'hello there' }],
      turns: [{
        id: 't1',
        prompt: 'hi',
        outcome: 'done',
        summary: 'said hello',
        steps: 1,
        traceFile: '/tmp/trace-1.json',
        events: ['said hello'],
      }],
    };

    new FileChatSessionRepository({ sessionStoragePath: sessionsFile }).save([session]);

    const catalog = JSON.parse(readFileSync(join(dir, 'chat-sessions.catalog.json'), 'utf8')) as {
      version: number;
      sessions: Array<Record<string, unknown>>;
    };
    const storedCatalog = new FileChatSessionRepository({ sessionStoragePath: sessionsFile }).readCatalog();
    const storedSession = new FileChatSessionRepository({ sessionStoragePath: sessionsFile }).read('session-1');

    expect(catalog.version).toBe(1);
    expect(storedCatalog[0]).toEqual(expect.objectContaining({
      id: 'session-1',
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
    expect(storedSession).toEqual(expect.objectContaining({
      id: 'session-1',
      workspaceId: 'workspace-1',
      pinned: true,
      archivedAt: '2026-04-13T02:00:00.000Z',
      reasoningEffort: 'high',
      history: [],
      messages: [{ id: 'm1', role: 'assistant', text: 'hello there' }],
      turns: [{
        id: 't1',
        prompt: 'hi',
        outcome: 'done',
        summary: 'said hello',
        steps: 1,
        traceFile: '/tmp/trace-1.json',
        events: ['said hello'],
      }],
    }));
  });

  it('uses the session codec to skip corrupted optional disk fields without losing the session', () => {
    const dir = mkdtempSync(join(tmpdir(), 'heddle-chat-storage-codec-'));
    const sessionsFile = join(dir, 'chat-sessions.catalog.json');

    writeFileSync(join(dir, 'chat-sessions.catalog.json'), JSON.stringify({
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
        { id: 'm1', role: 'assistant', text: 'valid visible message' },
        { id: 'm2', role: 'system', text: 'invalid visible message' },
      ],
      turns: [
        {
          id: 't1',
          prompt: 'valid prompt',
          outcome: 'done',
          summary: 'valid turn',
          steps: 1,
          traceFile: '/tmp/trace-1.json',
          events: ['done'],
        },
        { id: 't2', prompt: 'invalid turn' },
      ],
    }, null, 2));

    const session = new FileChatSessionRepository({ sessionStoragePath: sessionsFile }).read('session-1');

    expect(session).toEqual(expect.objectContaining({
      id: 'session-1',
      context: undefined,
      archives: [],
      pinned: false,
      history: [{ role: 'user', content: 'valid prompt' }],
      messages: [{ id: 'm1', role: 'assistant', text: 'valid visible message' }],
      turns: [{
        id: 't1',
        prompt: 'valid prompt',
        outcome: 'done',
        summary: 'valid turn',
        steps: 1,
        traceFile: '/tmp/trace-1.json',
        events: ['done'],
      }],
    }));
  });

  it('drops legacy welcome assistant lines from visible session messages', () => {
    const dir = mkdtempSync(join(tmpdir(), 'heddle-chat-storage-legacy-welcome-'));
    const sessionsFile = join(dir, 'chat-sessions.catalog.json');

    writeFileSync(join(dir, 'chat-sessions.catalog.json'), JSON.stringify({
      version: 1,
      sessions: [{
        id: 'session-1',
        name: 'Session 1',
        createdAt: '2026-04-13T00:00:00.000Z',
        updatedAt: '2026-04-13T01:00:00.000Z',
      }],
    }, null, 2));
    const sessionsDir = join(dir, 'chat-sessions');
    mkdirSync(sessionsDir);
    writeFileSync(join(sessionsDir, 'session-1.json'), JSON.stringify({
      id: 'session-1',
      history: [],
      messages: [
        { id: 'intro', role: 'assistant', text: 'Heddle conversational mode.' },
        { id: 'missing-key', role: 'assistant', text: 'No provider credential detected.' },
        { id: 'm1', role: 'assistant', text: 'real assistant output' },
      ],
      turns: [],
    }, null, 2));

    expect(new FileChatSessionRepository({ sessionStoragePath: sessionsFile }).read('session-1')?.messages).toEqual([
      { id: 'm1', role: 'assistant', text: 'real assistant output' },
    ]);
  });

  it('persists reasoning effort in catalog and per-session storage when configured', () => {
    const dir = mkdtempSync(join(tmpdir(), 'heddle-chat-storage-reasoning-'));
    const sessionsFile = join(dir, 'chat-sessions.catalog.json');
    const session = {
      ...ChatSessionRecords.create({
        id: 'session-1',
        name: 'Session 1',
        workspaceId: 'workspace-1',
      }),
      model: 'gpt-5.5',
      reasoningEffort: 'high' as const,
    };

    new FileChatSessionRepository({ sessionStoragePath: sessionsFile }).save([session]);

    expect(new FileChatSessionRepository({ sessionStoragePath: sessionsFile }).readCatalog()[0]).toEqual(expect.objectContaining({
      id: 'session-1',
      model: 'gpt-5.5',
      reasoningEffort: 'high',
    }));
    expect(new FileChatSessionRepository({ sessionStoragePath: sessionsFile }).read('session-1')).toEqual(expect.objectContaining({
      id: 'session-1',
      model: 'gpt-5.5',
      reasoningEffort: 'high',
    }));
  });

  it('orders pinned sessions before unpinned sessions while preserving recency within each group', () => {
    const dir = mkdtempSync(join(tmpdir(), 'heddle-chat-storage-pinned-order-'));
    const sessionsFile = join(dir, 'chat-sessions.catalog.json');
    const oldPinned = {
      ...ChatSessionRecords.create({ id: 'session-old-pinned', name: 'Old pinned' }),
      pinned: true,
      updatedAt: '2026-04-13T00:00:00.000Z',
    };
    const newPinned = {
      ...ChatSessionRecords.create({ id: 'session-new-pinned', name: 'New pinned' }),
      pinned: true,
      updatedAt: '2026-04-13T02:00:00.000Z',
    };
    const newRegular = {
      ...ChatSessionRecords.create({ id: 'session-new-regular', name: 'New regular' }),
      updatedAt: '2026-04-13T03:00:00.000Z',
    };

    const repository = new FileChatSessionRepository({ sessionStoragePath: sessionsFile });
    repository.save([newRegular, oldPinned, newPinned]);

    expect(repository.list().map((session) => session.id)).toEqual([
      'session-new-pinned',
      'session-old-pinned',
      'session-new-regular',
    ]);
    expect(repository.readCatalog().map((session) => session.id)).toEqual([
      'session-new-pinned',
      'session-old-pinned',
      'session-new-regular',
    ]);
  });

  it('does not rewrite unchanged session files when saving again', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'heddle-chat-storage-'));
    const sessionsFile = join(dir, 'chat-sessions.catalog.json');
    const session = ChatSessionRecords.create({
      id: 'session-1',
      name: 'Session 1',
    });

    new FileChatSessionRepository({ sessionStoragePath: sessionsFile }).save([session]);
    const sessionFile = join(dir, 'chat-sessions', 'session-1.json');
    const firstMtime = statSync(sessionFile).mtimeMs;

    await new Promise((resolve) => setTimeout(resolve, 20));
    new FileChatSessionRepository({ sessionStoragePath: sessionsFile }).save([session]);
    const secondMtime = statSync(sessionFile).mtimeMs;

    expect(secondMtime).toBe(firstMtime);
  });

  it('preserves custom catalog filenames instead of collapsing them to the default layout', () => {
    const dir = mkdtempSync(join(tmpdir(), 'heddle-chat-storage-custom-catalog-'));
    const configuredCatalogPath = join(dir, 'embedded-sessions.catalog.json');

    expect(FileChatSessionRepository.deriveStoragePaths(configuredCatalogPath)).toEqual({
      catalogPath: configuredCatalogPath,
      sessionsDir: join(dir, 'embedded-sessions'),
    });
  });
});
