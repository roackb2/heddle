import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createChatTurnPersistenceArtifacts } from '../../../core/chat/session-turn-result.js';
import { loadChatSessions, saveChatSessions } from '../../../core/chat/storage.js';
import { persistCompletedChatTurn } from '../../../core/chat/turn-persistence.js';
import { createTraceSummarizerRegistry } from '../../../core/observability/trace-summarizers.js';
import type { AgentLoopResult } from '../../../core/runtime/agent-loop.js';
import type { ChatSession } from '../../../core/chat/types.js';
import type { RunResult } from '../../../core/types.js';

describe('chat turn persistence', () => {
  it('uses a supplied trace summarizer registry for persisted turn events', async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), 'heddle-turn-persistence-'));
    const session = createSession();
    const result: RunResult = {
      outcome: 'done',
      summary: 'Done.',
      trace: [
        {
          type: 'tool.call',
          call: { id: 'call-1', tool: 'read_file', input: { path: 'README.md' } },
          step: 1,
          timestamp: '2026-05-02T00:00:00.000Z',
        },
      ],
      transcript: [
        { role: 'user', content: 'Read README.' },
        { role: 'assistant', content: 'Done.' },
      ],
    };

    const artifacts = await createChatTurnPersistenceArtifacts({
      result,
      prompt: 'Read README.',
      session,
      model: 'gpt-5.4',
      stateRoot,
      traceDir: join(stateRoot, 'traces'),
      toolNames: ['read_file'],
      historyForTokenEstimate: session.history,
      summarizer: {},
      traceSummarizerRegistry: createTraceSummarizerRegistry({
        'tool.call': (event) => `custom summary for ${event.call.tool}`,
      }),
      createTurnId: () => 'turn-1',
    });

    expect(artifacts.turn.events).toEqual(['custom summary for read_file']);
  });

  it('persists the completed turn back to session storage', async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), 'heddle-turn-persistence-save-'));
    const sessionStoragePath = join(stateRoot, 'chat-sessions.catalog.json');
    const session = createSession();
    saveChatSessions(sessionStoragePath, [session]);

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

    const persisted = await persistCompletedChatTurn({
      result,
      prompt: 'Persist this turn.',
      session,
      sessions: [session],
      sessionStoragePath,
      model: 'gpt-5.4',
      stateRoot,
      toolNames: ['read_file'],
      historyForTokenEstimate: session.history,
      credentialSource: { type: 'explicit-api-key' },
    });

    const stored = loadChatSessions(sessionStoragePath, true)[0];
    expect(stored?.id).toBe(session.id);
    expect(stored?.lastContinuePrompt).toBe('Persist this turn.');
    expect(stored?.messages.map((message) => message.text)).toEqual(['Persist this turn.', 'Done.']);
    expect(stored?.turns).toHaveLength(1);
    expect(stored?.turns[0]?.traceFile).toBe(persisted.traceFile);
    expect(stored?.lease).toBeUndefined();
  });
});

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
