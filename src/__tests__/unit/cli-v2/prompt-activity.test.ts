import { describe, expect, it } from 'vitest';
import { buildPromptActivity } from '../../../cli-v2/helpers/activities/prompt-activity.js';
import type { ControlPlaneSessionStoreSnapshot } from '../../../cli-v2/state/control-plane-session-store.js';

describe('buildPromptActivity', () => {
  it('prefers errors over latest activity', () => {
    expect(buildPromptActivity(createSnapshot({
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
    expect(buildPromptActivity(createSnapshot({
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
    expect(buildPromptActivity(createSnapshot({
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
