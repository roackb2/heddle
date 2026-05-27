import { describe, expect, it } from 'vitest';
import type { ControlPlaneSessionDetail } from '../../../client-shared/api/types.js';
import { ClientSharedSessionMessageService } from '../../../client-shared/services/session-messages/session-message-service.js';

describe('ClientSharedSessionMessageService', () => {
  it('preserves optimistic user messages across stale persisted snapshots', () => {
    const current = sessionWithMessages([
      { id: 'persisted-assistant', role: 'assistant', text: 'Previous answer.' },
      { id: 'live-user', role: 'user', text: 'What is this project about?' },
    ]);
    const stale = sessionWithMessages([
      { id: 'persisted-assistant', role: 'assistant', text: 'Previous answer.' },
    ]);

    expect(ClientSharedSessionMessageService.mergeTransientMessages(current, stale)?.messages).toEqual([
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

    expect(ClientSharedSessionMessageService.mergeTransientMessages(current, persisted)?.messages).toEqual([
      { id: 'persisted-user', role: 'user', text: 'What is this project about?' },
      { id: 'persisted-assistant', role: 'assistant', text: 'Heddle is a coding agent runtime.' },
    ]);
  });

  it('keeps live assistant stream idempotent and after the optimistic user turn', () => {
    const current = sessionWithMessages([
      { id: 'persisted-assistant', role: 'assistant', text: 'Previous answer.' },
      { id: 'live-assistant', role: 'assistant', text: 'Thinking: Inspecting project details' },
      { id: 'live-user', role: 'user', text: 'What is this project about?' },
    ]);

    expect(ClientSharedSessionMessageService.upsertLiveAssistantMessage(
      current,
      'Thinking: Investigating project details',
      false,
    )?.messages).toEqual([
      { id: 'persisted-assistant', role: 'assistant', text: 'Previous answer.' },
      { id: 'live-user', role: 'user', text: 'What is this project about?' },
      {
        id: 'live-assistant',
        role: 'assistant',
        text: 'Thinking: Investigating project details',
        isPending: true,
        isStreaming: true,
      },
    ]);
  });

  it('keeps transient user before transient assistant during stale snapshot merges', () => {
    const current = sessionWithMessages([
      { id: 'persisted-assistant', role: 'assistant', text: 'Previous answer.' },
      {
        id: 'live-assistant',
        role: 'assistant',
        text: 'Thinking: Investigating project details',
        isPending: true,
        isStreaming: true,
      },
      { id: 'live-user', role: 'user', text: 'What is this project about?' },
    ]);
    const stale = sessionWithMessages([
      { id: 'persisted-assistant', role: 'assistant', text: 'Previous answer.' },
    ]);

    expect(ClientSharedSessionMessageService.mergeTransientMessages(current, stale)?.messages).toEqual([
      { id: 'persisted-assistant', role: 'assistant', text: 'Previous answer.' },
      { id: 'live-user', role: 'user', text: 'What is this project about?' },
      {
        id: 'live-assistant',
        role: 'assistant',
        text: 'Thinking: Investigating project details',
        isPending: true,
        isStreaming: true,
      },
    ]);
  });

  it('does not preserve transient messages across workspaces with colliding session ids', () => {
    const current = sessionWithMessages([
      { id: 'live-user', role: 'user', text: 'Old workspace prompt' },
    ], 'workspace-1');
    const next = sessionWithMessages([
      { id: 'persisted-assistant', role: 'assistant', text: 'Different workspace.' },
    ], 'workspace-2');

    expect(ClientSharedSessionMessageService.mergeTransientMessages(current, next)?.messages).toEqual([
      { id: 'persisted-assistant', role: 'assistant', text: 'Different workspace.' },
    ]);
  });

});

function sessionWithMessages(
  messages: NonNullable<ControlPlaneSessionDetail>['messages'],
  workspaceId?: string,
): ControlPlaneSessionDetail {
  return {
    id: 'session-1',
    name: 'Session 1',
    workspaceId,
    messageCount: messages.length,
    turnCount: 0,
    messages,
    turns: [],
  };
}
