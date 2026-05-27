import { describe, expect, it } from 'vitest';
import { PromptActivityService } from '../../../cli-v2/services/activities/prompt-activity-service.js';
import type { ControlPlaneSessionStoreSnapshot } from '../../../cli-v2/state/control-plane-session-store.js';

describe('PromptActivityService', () => {
  it('prefers errors over latest activity', () => {
    expect(PromptActivityService.build(createSnapshot({
      error: 'Something failed',
      latestUpdate: {
        label: 'Run started',
        tone: 'info',
      },
    }))).toEqual({
      text: 'Error: Something failed',
      color: 'red',
    });
  });

  it('uses the richer latest activity before falling back to live status', () => {
    expect(PromptActivityService.build(createSnapshot({
      liveStatus: 'Run started...',
      latestUpdate: {
        label: 'Run started',
        detail: 'gpt-5.4 via openai',
        tone: 'info',
      },
    }))).toEqual({
      text: 'Latest: Run started · gpt-5.4 via openai',
      color: 'blue',
    });
  });

  it('falls back to live status when no latest activity exists', () => {
    expect(PromptActivityService.build(createSnapshot({
      liveStatus: 'Receiving assistant response...',
    }))).toEqual({
      text: 'Status: Receiving assistant response...',
      color: 'yellow',
    });
  });
});

function createSnapshot(
  overrides: Partial<ControlPlaneSessionStoreSnapshot> = {},
): ControlPlaneSessionStoreSnapshot {
  return {
    sessions: [],
    activeSession: null,
    pendingApproval: null,
    loading: false,
    submitting: false,
    approvalResolving: false,
    running: false,
    cancelling: false,
    streamConnected: false,
    ...overrides,
  };
}
