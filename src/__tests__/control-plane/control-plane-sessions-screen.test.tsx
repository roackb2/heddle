// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatSessionDetail, ChatTurnReview, ControlPlaneState } from '../../web/lib/api.js';
import { SessionsScreen } from '../../web/features/control-plane/screens/SessionsScreen.js';
import {
  fetchModelOptions,
  fetchWorkspaceChanges,
  fetchWorkspaceFileDiff,
} from '../../web/lib/api.js';

vi.mock('../../web/lib/api.js', () => ({
  fetchModelOptions: vi.fn(),
  fetchWorkspaceChanges: vi.fn(),
  fetchWorkspaceFileDiff: vi.fn(),
  fetchWorkspaceFileSuggestions: vi.fn(),
}));

const sessionSummary: ControlPlaneState['sessions'][number] = {
  id: 'session-1',
  name: 'Session 1',
  workspaceId: 'default',
  updatedAt: '2026-04-26T00:00:00.000Z',
  model: 'gpt-5.1-codex',
  driftEnabled: true,
  driftLevel: 'low',
  messageCount: 1,
  turnCount: 1,
};

const sessionDetail: ChatSessionDetail = {
  ...sessionSummary,
  messages: [{
    id: 'message-1',
    role: 'assistant',
    text: 'Done.',
  }],
  turns: [{
    id: 'turn-1',
    prompt: 'Edit docs',
    outcome: 'done',
    summary: 'Updated docs.',
    steps: 1,
    traceFile: '/tmp/trace.json',
    events: [],
  }],
};

const turnReview: ChatTurnReview = {
  traceFile: '/tmp/trace.json',
  files: [{
    path: 'src/example.ts',
    status: 'modified',
    source: 'edit_file',
    patch: 'diff --git a/src/example.ts b/src/example.ts\n-old\n+turn',
    truncated: false,
  }],
  reviewCommands: [],
  verificationCommands: [],
  mutationCommands: [],
  approvals: [],
};

describe('SessionsScreen review UI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchModelOptions).mockResolvedValue({ groups: [] });
    vi.mocked(fetchWorkspaceChanges).mockResolvedValue({
      vcs: 'git',
      clean: false,
      files: [{
        path: 'src/example.ts',
        status: 'modified',
        workingTreeStatus: 'M',
        additions: 1,
        deletions: 1,
      }],
    });
    vi.mocked(fetchWorkspaceFileDiff).mockResolvedValue({
      vcs: 'git',
      path: 'src/example.ts',
      patch: 'diff --git a/src/example.ts b/src/example.ts\n-old\n+new',
      truncated: false,
      binary: false,
    });
  });

  it('renders current workspace diff separately from trace-backed turn review', async () => {
    render(
      <SessionsScreen
        sessions={[sessionSummary]}
        activeSession={sessionSummary}
        sessionDetail={sessionDetail}
        sessionDetailLoading={false}
        selectedSessionId="session-1"
        onSelectSession={() => undefined}
        selectedTurnId="turn-1"
        onSelectTurn={() => undefined}
        selectedTurn={sessionDetail.turns[0]}
        turnReview={turnReview}
        turnReviewLoading={false}
        sendingPrompt={false}
        runInFlight={false}
        memoryUpdating={false}
        onSendPrompt={async () => undefined}
        creatingSession={false}
        onCreateSession={async () => undefined}
        onContinueSession={async () => undefined}
        onCancelSessionRun={async () => undefined}
        onUpdateSessionSettings={async () => undefined}
        pendingApproval={null}
        onResolveApproval={async () => undefined}
        inspectorTab="review"
        onInspectorTabChange={() => undefined}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Current workspace changes')).toBeTruthy();
      expect(screen.getByText('src/example.ts')).toBeTruthy();
      expect(screen.getByText(/diff --git a\/src\/example.ts/)).toBeTruthy();
      expect(screen.getByText('Current workspace differs from captured turn')).toBeTruthy();
    });
    expect(screen.getByText('Turn history')).toBeTruthy();
    expect(screen.getByText('Evidence')).toBeTruthy();
    expect(fetchWorkspaceChanges).toHaveBeenCalledTimes(1);
    expect(fetchWorkspaceFileDiff).toHaveBeenCalledWith('src/example.ts');

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => {
      expect(fetchWorkspaceChanges).toHaveBeenCalledTimes(2);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Turn history' }));
    await waitFor(() => {
      expect(screen.getByText('Captured turn diff')).toBeTruthy();
      expect(screen.getByText('Raw turn patch')).toBeTruthy();
    });
  });
});
