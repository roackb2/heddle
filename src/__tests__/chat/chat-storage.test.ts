import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createChatSession, migrateLegacyChatSessions, readChatSession, readChatSessionCatalog, saveChatSessions } from '../../cli/chat/state/storage.js';

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

    const sessions = migrateLegacyChatSessions(sessionsFile, true);

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
      ...createChatSession({
        id: 'session-1',
        name: 'Session 1',
        apiKeyPresent: true,
        workspaceId: 'workspace-1',
      }),
      model: 'gpt-5.1-codex-mini',
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

    saveChatSessions(sessionsFile, [session]);

    const catalog = JSON.parse(readFileSync(join(dir, 'chat-sessions.catalog.json'), 'utf8')) as {
      version: number;
      sessions: Array<Record<string, unknown>>;
    };
    const storedCatalog = readChatSessionCatalog(sessionsFile);
    const storedSession = readChatSession(sessionsFile, 'session-1', true);

    expect(catalog.version).toBe(1);
    expect(storedCatalog[0]).toEqual(expect.objectContaining({
      id: 'session-1',
      name: 'Session 1',
      workspaceId: 'workspace-1',
      model: 'gpt-5.1-codex-mini',
      lastContinuePrompt: 'continue',
      context: { estimatedHistoryTokens: 42 },
    }));
    expect(catalog.sessions[0]?.messages).toBeUndefined();
    expect(storedSession).toEqual(expect.objectContaining({
      id: 'session-1',
      workspaceId: 'workspace-1',
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

  it('does not rewrite unchanged session files when saving again', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'heddle-chat-storage-'));
    const sessionsFile = join(dir, 'chat-sessions.json');
    const session = createChatSession({
      id: 'session-1',
      name: 'Session 1',
      apiKeyPresent: true,
    });

    saveChatSessions(sessionsFile, [session]);
    const sessionFile = join(dir, 'chat-sessions', 'session-1.json');
    const firstMtime = statSync(sessionFile).mtimeMs;

    await new Promise((resolve) => setTimeout(resolve, 20));
    saveChatSessions(sessionsFile, [session]);
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

    const sessions = migrateLegacyChatSessions(sessionsFile, true);

    expect(sessions[0]?.workspaceId).toBe('workspace-1');
    expect(readChatSessionCatalog(sessionsFile)[0]?.workspaceId).toBe('workspace-1');
  });
});
