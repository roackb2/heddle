import { describe, expect, it } from 'vitest';
import { ClientSharedConversationRunStreamService } from '@/client-shared/services/conversation-run-stream/index.js';
import type { ControlPlaneSessionRunEventEnvelope } from '@/client-shared/api/types.js';

describe('ClientSharedConversationRunStreamService', () => {
  it('advances replay cursors, suppresses duplicates, and resumes from the latest sequence', () => {
    const service = new ClientSharedConversationRunStreamService();
    service.select({ workspaceId: 'workspace-1', sessionId: 'session-1', runId: 'run-1' });

    expect(service.accept(activity(1))).toEqual({ accepted: true, terminal: false });
    expect(service.accept(activity(1))).toEqual({ accepted: false, terminal: false });
    expect(service.nextRetry()).toEqual({
      attempt: 1,
      delayMs: 500,
      input: {
        workspaceId: 'workspace-1',
        sessionId: 'session-1',
        runId: 'run-1',
        afterSequence: 1,
      },
    });
  });

  it('rejects sequence gaps instead of silently losing run activity', () => {
    const service = new ClientSharedConversationRunStreamService();
    service.select({ workspaceId: 'workspace-1', sessionId: 'session-1', runId: 'run-1' });

    expect(() => service.accept(activity(2))).toThrow('expected 1, received 2');
  });

  it('stops reconnecting after a terminal item and resets for the next run', () => {
    const service = new ClientSharedConversationRunStreamService();
    service.select({ workspaceId: 'workspace-1', sessionId: 'session-1', runId: 'run-1' });

    expect(service.accept(result(1))).toEqual({ accepted: true, terminal: true });
    expect(service.nextRetry()).toBeUndefined();

    expect(service.select({ workspaceId: 'workspace-1', sessionId: 'session-1', runId: 'run-2' })).toBe(true);
    expect(service.subscriptionInput()).toEqual({
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
      runId: 'run-2',
      afterSequence: 0,
    });
  });
});

function activity(sequence: number): ControlPlaneSessionRunEventEnvelope {
  return {
    kind: 'activity',
    runId: 'run-1',
    sequence,
    timestamp: '2026-07-11T00:00:00.000Z',
    activity: {
      source: 'agent-loop',
      type: 'assistant.stream',
      runId: 'run-1',
      step: 1,
      text: 'Working',
      done: false,
      timestamp: '2026-07-11T00:00:00.000Z',
    },
  };
}

function result(sequence: number): ControlPlaneSessionRunEventEnvelope {
  return {
    kind: 'result',
    runId: 'run-1',
    sequence,
    timestamp: '2026-07-11T00:00:01.000Z',
    result: {},
  };
}
