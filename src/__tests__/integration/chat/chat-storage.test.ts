import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ChatSessionRecords } from '../../../core/chat/engine/sessions/records/index.js';
import { FileChatSessionRepository } from '../../../core/chat/engine/sessions/repository/index.js';

describe('chat session storage layout', () => {
  it('migrates legacy chat-sessions.json into catalog plus per-session files without deleting the original file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'heddle-chat-storage-'));
    const sessionsFile = join(dir, 'chat-sessions.json');
    writeFileSync(sessionsFile, JSON.stringify([
      {
        id: 'session-1',
        name: 'Session 1',
        history: [{ role: 'user', content: 'hello' }],
        messages: [{ id: 'm1', role: 'assistant', text: 'hi' }],
        turns: [{
          id: 't1',
          prompt: 'hello',
          outcome: 'done',
          summary: 'responded',
          steps: 1,
          traceFile: '/tmp/trace-1.json',
          events: ['assistant replied'],
        }],
        createdAt: '2026-04-13T00:00:00.000Z',
        updatedAt: '2026-04-13T01:00:00.000Z',
      },
    ], null, 2));

    const sessions = new FileChatSessionRepository({ sessionStoragePath: sessionsFile }).migrateLegacy(true);

    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.id).toBe('session-1');
    expect(existsSync(sessionsFile)).toBe(true);
    expect(existsSync(join(dir, 'chat-sessions.catalog.json'))).toBe(true);
    expect(existsSync(join(dir, 'chat-sessions', 'session-1.json'))).toBe(true);

    const catalog = JSON.parse(readFileSync(join(dir, 'chat-sessions.catalog.json'), 'utf8')) as {
      version: number;
      sessions: Array<{ id: string; name: string }>;
    };
    expect(catalog.version).toBe(1);
    expect(catalog.sessions).toEqual([
      expect.objectContaining({ id: 'session-1', name: 'Session 1' }),
    ]);
  });

  it('writes catalog metadata separately from per-session transcript bodies', () => {
    const dir = mkdtempSync(join(tmpdir(), 'heddle-chat-storage-'));
    const sessionsFile = join(dir, 'chat-sessions.json');
    const session = {
      ...ChatSessionRecords.create({
        id: 'session-1',
        name: 'Session 1',
        apiKeyPresent: true,
        workspaceId: 'workspace-1',
      }),
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
    const storedSession = new FileChatSessionRepository({ sessionStoragePath: sessionsFile }).read('session-1', true);

    expect(catalog.version).toBe(1);
    expect(storedCatalog[0]).toEqual(expect.objectContaining({
      id: 'session-1',
      name: 'Session 1',
      workspaceId: 'workspace-1',
      model: 'gpt-5.1-codex-mini',
      reasoningEffort: 'high',
      lastContinuePrompt: 'continue',
      context: { estimatedHistoryTokens: 42 },
    }));
    expect(catalog.sessions[0]?.messages).toBeUndefined();
    expect(storedSession).toEqual(expect.objectContaining({
      id: 'session-1',
      workspaceId: 'workspace-1',
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

  it('persists reasoning effort in catalog and per-session storage when configured', () => {
    const dir = mkdtempSync(join(tmpdir(), 'heddle-chat-storage-reasoning-'));
    const sessionsFile = join(dir, 'chat-sessions.json');
    const session = {
      ...ChatSessionRecords.create({
        id: 'session-1',
        name: 'Session 1',
        apiKeyPresent: true,
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
    expect(new FileChatSessionRepository({ sessionStoragePath: sessionsFile }).read('session-1', true)).toEqual(expect.objectContaining({
      id: 'session-1',
      model: 'gpt-5.5',
      reasoningEffort: 'high',
    }));
  });

  it('does not rewrite unchanged session files when saving again', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'heddle-chat-storage-'));
    const sessionsFile = join(dir, 'chat-sessions.json');
    const session = ChatSessionRecords.create({
      id: 'session-1',
      name: 'Session 1',
      apiKeyPresent: true,
    });

    new FileChatSessionRepository({ sessionStoragePath: sessionsFile }).save([session]);
    const sessionFile = join(dir, 'chat-sessions', 'session-1.json');
    const firstMtime = statSync(sessionFile).mtimeMs;

    await new Promise((resolve) => setTimeout(resolve, 20));
    new FileChatSessionRepository({ sessionStoragePath: sessionsFile }).save([session]);
    const secondMtime = statSync(sessionFile).mtimeMs;

    expect(secondMtime).toBe(firstMtime);
  });

  it('preserves workspaceId when migrating legacy sessions', () => {
    const dir = mkdtempSync(join(tmpdir(), 'heddle-chat-storage-workspace-'));
    const sessionsFile = join(dir, 'chat-sessions.json');
    writeFileSync(sessionsFile, JSON.stringify([
      {
        id: 'session-1',
        name: 'Session 1',
        workspaceId: 'workspace-1',
        history: [],
        messages: [],
        turns: [],
      },
    ], null, 2));

    const sessions = new FileChatSessionRepository({ sessionStoragePath: sessionsFile }).migrateLegacy(true);

    expect(sessions[0]?.workspaceId).toBe('workspace-1');
    expect(new FileChatSessionRepository({ sessionStoragePath: sessionsFile }).readCatalog()[0]?.workspaceId).toBe('workspace-1');
  });

  it('preserves custom catalog filenames instead of collapsing them to the default layout', () => {
    const dir = mkdtempSync(join(tmpdir(), 'heddle-chat-storage-custom-catalog-'));
    const configuredCatalogPath = join(dir, 'embedded-sessions.catalog.json');

    expect(FileChatSessionRepository.deriveStoragePaths(configuredCatalogPath)).toEqual({
      catalogPath: configuredCatalogPath,
      legacyPath: join(dir, 'embedded-sessions.json'),
      sessionsDir: join(dir, 'embedded-sessions'),
    });
  });

  it('upgrades legacy custom json filenames into sibling catalog storage', () => {
    const dir = mkdtempSync(join(tmpdir(), 'heddle-chat-storage-custom-legacy-'));
    const legacyPath = join(dir, 'embedded-sessions.json');

    expect(FileChatSessionRepository.deriveStoragePaths(legacyPath)).toEqual({
      catalogPath: join(dir, 'embedded-sessions.catalog.json'),
      legacyPath,
      sessionsDir: join(dir, 'embedded-sessions'),
    });
  });
});
