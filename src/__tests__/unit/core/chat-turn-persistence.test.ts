import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createChatTurnPersistenceArtifacts } from '../../../core/chat/session-turn-result.js';
import { createTraceSummarizerRegistry } from '../../../core/observability/trace-summarizers.js';
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
