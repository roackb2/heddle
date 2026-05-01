import { existsSync, mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runAskCli } from '../../../cli/ask.js';
import { createChatSession, readChatSession, readChatSessionCatalog, saveChatSessions } from '../../../core/chat/storage.js';
import type { ChatSession } from '../../../core/chat/types.js';
import type { ResolvedRuntimeHost } from '../../../core/runtime/runtime-hosts.js';
import type { RunResult } from '../../../index.js';
import { createHeddleServerApp } from '../../../server/app.js';

describe('runAskCli', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('runs a stateless ask and writes a trace file', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-ask-cli-'));
    const memoryRoot = join(workspaceRoot, '.heddle', 'memory');
    mkdirSync(memoryRoot, { recursive: true });
    writeFileSync(join(memoryRoot, 'README.md'), '# Workspace Memory\n\n- Ask uses memory context.\n', 'utf8');
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const result: RunResult = {
      outcome: 'done',
      summary: 'Stateless answer.',
      trace: [
        {
          type: 'assistant.turn',
          content: 'Stateless answer.',
          requestedTools: false,
          step: 1,
          timestamp: '2026-04-21T00:00:01.000Z',
        },
      ],
      transcript: [
        { role: 'user', content: 'what is this project' },
        { role: 'assistant', content: 'Stateless answer.' },
      ],
    };
    const runAgentLoopSpy = vi.spyOn(await import('../../../index.js'), 'runAgentLoop').mockResolvedValue(result as never);

    await runAskCli('what is this project', {
      workspaceRoot,
      model: 'gpt-5.1-codex-mini',
      apiKey: 'test-key',
    });

    expect(runAgentLoopSpy).toHaveBeenCalledTimes(1);
    expect(runAgentLoopSpy).toHaveBeenCalledWith(expect.objectContaining({
      systemContext: expect.stringContaining('- Ask uses memory context.'),
    }));
    expect(existsSync(join(workspaceRoot, '.heddle', 'traces'))).toBe(true);
    expect(stdoutSpy).toHaveBeenCalled();
  });

  it('creates a new session and persists the ask transcript when requested', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-ask-cli-session-'));
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const result: RunResult = {
      outcome: 'done',
      summary: 'Session-backed answer.',
      trace: [
        {
          type: 'assistant.turn',
          content: 'Session-backed answer.',
          requestedTools: false,
          step: 1,
          timestamp: '2026-04-21T00:00:01.000Z',
        },
      ],
      transcript: [
        { role: 'user', content: 'inspect the repository' },
        { role: 'assistant', content: 'Session-backed answer.' },
      ],
    };
    vi.spyOn(await import('../../../index.js'), 'runAgentLoop').mockResolvedValue(result as never);

    await runAskCli('inspect the repository', {
      workspaceRoot,
      model: 'gpt-5.1-codex-mini',
      apiKey: 'test-key',
      createSessionName: 'Ask test session',
    });

    const sessionStoragePath = join(workspaceRoot, '.heddle', 'chat-sessions.catalog.json');
    const catalog = readChatSessionCatalog(sessionStoragePath);
    expect(catalog).toHaveLength(1);
    expect(catalog[0]?.name).toBe('Ask test session');

    const session = readChatSession(sessionStoragePath, catalog[0]!.id, true);
    expect(session?.history).toEqual(result.transcript);
    expect(session?.turns).toHaveLength(1);
    expect(session?.lastContinuePrompt).toBe('inspect the repository');
    expect(session?.workspaceId).toBe('default');
    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining(`Session: ${catalog[0]!.id}`));
  });

  it('continues an existing session by id and reuses its history', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-ask-cli-continue-'));
    const stateRoot = join(workspaceRoot, '.heddle');
    const sessionStoragePath = join(stateRoot, 'chat-sessions.catalog.json');
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const existingSession: ChatSession = {
      ...createChatSession({
        id: 'session-existing',
        name: 'Existing session',
        apiKeyPresent: true,
        model: 'gpt-5.1-codex-mini',
      }),
      history: [
        { role: 'user', content: 'first question' },
        { role: 'assistant', content: 'first answer' },
      ],
      messages: [
        { id: 'user-1', role: 'user', text: 'first question' },
        { id: 'assistant-1', role: 'assistant', text: 'first answer' },
      ],
    };
    saveChatSessions(sessionStoragePath, [existingSession]);

    const result: RunResult = {
      outcome: 'done',
      summary: 'Follow-up answer.',
      trace: [
        {
          type: 'assistant.turn',
          content: 'Follow-up answer.',
          requestedTools: false,
          step: 1,
          timestamp: '2026-04-21T00:00:02.000Z',
        },
      ],
      transcript: [
        ...existingSession.history,
        { role: 'user', content: 'follow up question' },
        { role: 'assistant', content: 'Follow-up answer.' },
      ],
    };
    const runAgentLoopSpy = vi.spyOn(await import('../../../index.js'), 'runAgentLoop').mockImplementation(async (options) => {
      expect(options.history).toEqual(existingSession.history);
      expect(options.goal).toBe('follow up question');
      return result as never;
    });

    await runAskCli('follow up question', {
      workspaceRoot,
      model: 'gpt-5.1-codex-mini',
      apiKey: 'test-key',
      sessionId: existingSession.id,
    });

    const updated = readChatSession(sessionStoragePath, existingSession.id, true);
    expect(runAgentLoopSpy).toHaveBeenCalledTimes(1);
    expect(updated?.history).toEqual(result.transcript);
    expect(updated?.turns).toHaveLength(1);
    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining(`Session: ${existingSession.id}`));
  });

  it('preflight compacts an oversized session before ask-mode runAgentLoop executes', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-ask-cli-preflight-'));
    const stateRoot = join(workspaceRoot, '.heddle');
    const sessionStoragePath = join(stateRoot, 'chat-sessions.catalog.json');
    const existingSession: ChatSession = {
      ...createChatSession({
        id: 'session-preflight',
        name: 'Preflight session',
        apiKeyPresent: true,
        model: 'gpt-5.1-codex-mini',
      }),
      history: [
        { role: 'user', content: 'very large turn 1' },
        { role: 'assistant', content: 'very large answer 1' },
        { role: 'user', content: 'very large turn 2' },
        { role: 'assistant', content: 'very large answer 2' },
      ],
      messages: [
        { id: 'user-1', role: 'user', text: 'very large turn 1' },
        { id: 'assistant-1', role: 'assistant', text: 'very large answer 1' },
        { id: 'user-2', role: 'user', text: 'very large turn 2' },
        { id: 'assistant-2', role: 'assistant', text: 'very large answer 2' },
      ],
    };
    saveChatSessions(sessionStoragePath, [existingSession]);

    const compactedHistory = [
      { role: 'system' as const, content: 'Heddle compacted earlier conversation history.\n\nArchive root: .heddle/chat-sessions/session-preflight/archives' },
      { role: 'user' as const, content: 'very large turn 2' },
      { role: 'assistant' as const, content: 'very large answer 2' },
    ];
    const compactionSpy = vi.spyOn(await import('../../../core/chat/compaction.js'), 'compactChatHistoryWithArchive');
    compactionSpy
      .mockResolvedValueOnce({
        history: compactedHistory,
        context: {
          estimatedHistoryTokens: 123,
          compactionStatus: 'idle',
          archiveCount: 1,
          lastArchivePath: '.heddle/chat-sessions/session-preflight/archives/archive-1.jsonl',
        },
        archives: [{
          id: 'archive-1',
          path: '.heddle/chat-sessions/session-preflight/archives/archive-1.jsonl',
          summaryPath: '.heddle/chat-sessions/session-preflight/archives/archive-1.summary.md',
          messageCount: 2,
          createdAt: '2026-04-21T00:00:00.000Z',
          summaryModel: 'gpt-5.1-codex-mini',
        }],
      })
      .mockResolvedValueOnce({
        history: [
          ...compactedHistory,
          { role: 'user' as const, content: 'follow up question' },
          { role: 'assistant' as const, content: 'Follow-up answer.' },
        ],
        context: {
          estimatedHistoryTokens: 150,
          compactionStatus: 'idle',
          archiveCount: 1,
          lastArchivePath: '.heddle/chat-sessions/session-preflight/archives/archive-1.jsonl',
        },
        archives: [{
          id: 'archive-1',
          path: '.heddle/chat-sessions/session-preflight/archives/archive-1.jsonl',
          summaryPath: '.heddle/chat-sessions/session-preflight/archives/archive-1.summary.md',
          messageCount: 2,
          createdAt: '2026-04-21T00:00:00.000Z',
          summaryModel: 'gpt-5.1-codex-mini',
        }],
      });

    const result: RunResult = {
      outcome: 'done',
      summary: 'Follow-up answer.',
      trace: [
        {
          type: 'assistant.turn',
          content: 'Follow-up answer.',
          requestedTools: false,
          step: 1,
          timestamp: '2026-04-21T00:00:02.000Z',
        },
      ],
      transcript: [
        ...compactedHistory,
        { role: 'user', content: 'follow up question' },
        { role: 'assistant', content: 'Follow-up answer.' },
      ],
    };
    const runAgentLoopSpy = vi.spyOn(await import('../../../index.js'), 'runAgentLoop').mockImplementation(async (options) => {
      expect(options.history).toEqual(compactedHistory);
      return result as never;
    });

    await runAskCli('follow up question', {
      workspaceRoot,
      model: 'gpt-5.1-codex-mini',
      apiKey: 'test-key',
      sessionId: existingSession.id,
    });

    expect(compactionSpy).toHaveBeenCalledTimes(2);
    expect(runAgentLoopSpy).toHaveBeenCalledTimes(1);
    expect(readChatSession(sessionStoragePath, existingSession.id, true)?.archives).toHaveLength(1);
  });

  it('attaches stateless ask to a live daemon host', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-ask-cli-remote-stateless-'));
    const stateRoot = join(workspaceRoot, '.heddle');
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const result: RunResult = {
      outcome: 'done',
      summary: 'Remote stateless answer.',
      trace: [
        {
          type: 'assistant.turn',
          content: 'Remote stateless answer.',
          requestedTools: false,
          step: 1,
          timestamp: '2026-04-21T00:00:03.000Z',
        },
      ],
      transcript: [
        { role: 'user', content: 'daemon stateless ask' },
        { role: 'assistant', content: 'Remote stateless answer.' },
      ],
    };
    vi.spyOn(await import('../../../index.js'), 'runAgentLoop').mockResolvedValue(result as never);

    const server = createHeddleServerApp({ workspaceRoot, stateRoot }).listen(0, '127.0.0.1');
    await onceListening(server);
    const address = server.address() as AddressInfo;
    const runtimeHost: ResolvedRuntimeHost = {
      kind: 'daemon',
      registryPath: join(workspaceRoot, 'daemon-registry.json'),
      workspaceId: 'default',
      ownerId: 'daemon-owner',
      endpoint: { host: '127.0.0.1', port: address.port },
      startedAt: '2026-04-21T00:00:00.000Z',
      lastSeenAt: '2026-04-21T00:00:00.000Z',
      stale: false,
      ageMs: 0,
    };

    try {
      await runAskCli('daemon stateless ask', {
        workspaceRoot,
        model: 'gpt-5.1-codex-mini',
        apiKey: 'test-key',
        runtimeHost,
      });
    } finally {
      await closeServer(server);
    }

    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('attaching ask to daemon'));
    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('Trace:'));
  });

  it('attaches session-backed ask to a live daemon host', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-ask-cli-remote-session-'));
    const stateRoot = join(workspaceRoot, '.heddle');
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const result: RunResult = {
      outcome: 'done',
      summary: 'Remote session answer.',
      trace: [
        {
          type: 'assistant.turn',
          content: 'Remote session answer.',
          requestedTools: false,
          step: 1,
          timestamp: '2026-04-21T00:00:04.000Z',
        },
      ],
      transcript: [
        { role: 'user', content: 'remote session ask' },
        { role: 'assistant', content: 'Remote session answer.' },
      ],
    };
    vi.spyOn(await import('../../../index.js'), 'runAgentLoop').mockResolvedValue(result as never);

    const server = createHeddleServerApp({ workspaceRoot, stateRoot }).listen(0, '127.0.0.1');
    await onceListening(server);
    const address = server.address() as AddressInfo;
    const runtimeHost: ResolvedRuntimeHost = {
      kind: 'daemon',
      registryPath: join(workspaceRoot, 'daemon-registry.json'),
      workspaceId: 'default',
      ownerId: 'daemon-owner',
      endpoint: { host: '127.0.0.1', port: address.port },
      startedAt: '2026-04-21T00:00:00.000Z',
      lastSeenAt: '2026-04-21T00:00:00.000Z',
      stale: false,
      ageMs: 0,
    };

    try {
      await runAskCli('remote session ask', {
        workspaceRoot,
        model: 'gpt-5.1-codex-mini',
        apiKey: 'test-key',
        runtimeHost,
        createSessionName: 'Remote ask session',
      });
    } finally {
      await closeServer(server);
    }

    const catalog = readChatSessionCatalog(join(stateRoot, 'chat-sessions.catalog.json'));
    expect(catalog).toHaveLength(1);
    expect(catalog[0]?.name).toBe('Remote ask session');
    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining(`Session: ${catalog[0]?.id}`));
  });
});

async function onceListening(server: { once: (event: 'listening', listener: () => void) => void; listening?: boolean }) {
  if (server.listening) {
    return;
  }
  await new Promise<void>((resolve) => {
    server.once('listening', resolve);
  });
}

async function closeServer(server: { close: (listener: (error?: Error) => void) => void }) {
  await new Promise<void>((resolve, reject) => {
    server.close((error?: Error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
