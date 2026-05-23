import { describe, expect, it } from 'vitest';
import type { ControlPlaneSessionDetail } from '../../../web-v2/api/client.js';
import { SessionMessageController } from '../../../web-v2/controllers/session-messages/session-message-controller.js';

describe('SessionMessageController', () => {
  it('preserves optimistic user messages across stale persisted snapshots', () => {
    const current = sessionWithMessages([
      { id: 'persisted-assistant', role: 'assistant', text: 'Previous answer.' },
      { id: 'live-user', role: 'user', text: 'What is this project about?' },
    ]);
    const stale = sessionWithMessages([
      { id: 'persisted-assistant', role: 'assistant', text: 'Previous answer.' },
    ]);

    expect(SessionMessageController.mergeTransientMessages(current, stale)?.messages).toEqual([
      { id: 'persisted-assistant', role: 'assistant', text: 'Previous answer.' },
      { id: 'live-user', role: 'user', text: 'What is this project about?' },
    ]);
  });

  it('drops optimistic user messages once the persisted transcript contains the same turn', () => {
    const current = sessionWithMessages([
      { id: 'live-user', role: 'user', text: 'What is this project about?' },
    ]);
    const persisted = sessionWithMessages([
      { id: 'persisted-user', role: 'user', text: 'What is this project about?' },
      { id: 'persisted-assistant', role: 'assistant', text: 'Heddle is a coding agent runtime.' },
    ]);

    expect(SessionMessageController.mergeTransientMessages(current, persisted)?.messages).toEqual([
      { id: 'persisted-user', role: 'user', text: 'What is this project about?' },
      { id: 'persisted-assistant', role: 'assistant', text: 'Heddle is a coding agent runtime.' },
    ]);
  });
});

function sessionWithMessages(messages: NonNullable<ControlPlaneSessionDetail>['messages']): ControlPlaneSessionDetail {
  return {
    id: 'session-1',
    name: 'Session 1',
    messageCount: messages.length,
    turnCount: 0,
    messages,
    turns: [],
  };
}
