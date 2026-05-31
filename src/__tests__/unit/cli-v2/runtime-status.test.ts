import { describe, expect, it } from 'vitest';
import { RuntimeStatusService } from '../../../cli-v2/services/status/index.js';
import type { ControlPlaneSessionStoreSnapshot } from '../../../cli-v2/state/control-plane-session-store.js';

describe('RuntimeStatusService', () => {
  it('formats runtime context for the cli-v2 status bar', () => {
    expect(RuntimeStatusService.build(createSnapshot())).toBe(
      'model=gpt-5.4 • reasoning=medium • auth=openai-oauth • context window ~400,000 tokens • drift=off • session=session-1 (Session 1)',
    );
  });

  it('includes estimated input usage and running status when available', () => {
    expect(RuntimeStatusService.build(createSnapshot({
      running: true,
      runtimeContext: {
        ...createSnapshot().runtimeContext!,
        estimatedInputTokens: 20000,
        driftEnabled: true,
        driftLevel: 'low',
        running: true,
      },
    }))).toBe(
      'model=gpt-5.4 • reasoning=medium • auth=openai-oauth • estimated input 20,000 / 400,000 tokens (5%) • drift=low • session=session-1 (Session 1) • status=running',
    );
  });
});

function createSnapshot(overrides: Partial<ControlPlaneSessionStoreSnapshot> = {}): ControlPlaneSessionStoreSnapshot {
  return {
    workspaceId: 'workspace-1',
    sessions: [],
    activeSessionId: 'session-1',
    activeSession: null,
    runtimeContext: {
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
      sessionName: 'Session 1',
      model: 'gpt-5.4',
      reasoningEffort: 'medium',
      effectiveReasoningEffort: 'medium',
      reasoningSupported: true,
      reasoningOptions: [],
      credentialSource: {
        type: 'oauth',
        provider: 'openai',
        accountId: 'acct-test',
        expiresAt: Date.now() + 60_000,
      },
      contextWindow: 400000,
      driftEnabled: false,
      running: false,
      welcomeGuide: {
        mode: 'conversation',
        hasProviderCredential: true,
        carriesTranscriptAcrossTurns: true,
      },
    },
    pendingApproval: null,
    loading: false,
    submitting: false,
    approvalResolving: false,
    running: false,
    cancelling: false,
    streamConnected: false,
    commandResults: [],
    ...overrides,
  };
}
