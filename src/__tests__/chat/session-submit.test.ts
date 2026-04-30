import { beforeEach, describe, expect, it, vi } from 'vitest';
import { submitChatSessionPrompt } from '../../core/chat/session-submit.js';

const executeOrdinaryChatTurnMock = vi.hoisted(() => vi.fn());

vi.mock('../../core/chat/ordinary-turn.js', () => ({
  executeOrdinaryChatTurn: executeOrdinaryChatTurnMock,
  clearOrdinaryChatTurnLease: vi.fn(),
}));

describe('submitChatSessionPrompt', () => {
  beforeEach(() => {
    executeOrdinaryChatTurnMock.mockReset();
    executeOrdinaryChatTurnMock.mockResolvedValue({
      outcome: 'done',
      summary: 'ok',
      session: { id: 'session-1' },
    });
  });

  it('adapts compaction callbacks through the host port without also wiring the legacy callback', async () => {
    const onCompactionStatus = vi.fn();

    await submitChatSessionPrompt({
      workspaceRoot: '/tmp/workspace',
      stateRoot: '/tmp/workspace/.heddle',
      sessionStoragePath: '/tmp/workspace/.heddle/chat-sessions.catalog.json',
      sessionId: 'session-1',
      prompt: 'hello',
      onCompactionStatus,
    });

    const callArgs = executeOrdinaryChatTurnMock.mock.calls[0]?.[0];
    expect(callArgs).toBeTruthy();
    expect(callArgs.onCompactionStatus).toBeUndefined();
    expect(callArgs.host.compaction.onPreflightCompactionStatus).toBe(onCompactionStatus);
    expect(callArgs.host.compaction.onFinalCompactionStatus).toBe(onCompactionStatus);
  });
});
