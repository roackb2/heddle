// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatSessionDetail, ChatTurnReview, ControlPlaneState } from '../../../web/lib/api.js';
import { useSessionsScreenState } from '../../../web/features/control-plane/hooks/useSessionsScreenState.js';
import {
  continueChatSession,
  fetchChatSessionDetail,
  fetchChatTurnReview,
  fetchSessionRunningState,
  sendChatSessionPrompt,
  subscribeToChatSessionEvents,
} from '../../../web/lib/api.js';

vi.mock('../../../web/lib/api.js', () => ({
  cancelChatSession: vi.fn(),
  continueChatSession: vi.fn(),
  createChatSession: vi.fn(),
  fetchChatSessionDetail: vi.fn(),
  fetchChatTurnReview: vi.fn(),
  fetchPendingSessionApproval: vi.fn(async () => null),
  fetchSessionRunningState: vi.fn(),
  resolvePendingSessionApproval: vi.fn(),
  sendChatSessionPrompt: vi.fn(),
  subscribeToChatSessionEvents: vi.fn(() => () => undefined),
  updateChatSessionSettings: vi.fn(),
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
  createdAt: '2026-04-26T00:00:00.000Z',
  messages: [
    {
      id: 'message-1',
      role: 'assistant',
      text: 'Loaded.',
    },
  ],
  turns: [
    {
      id: 'turn-1',
      prompt: 'Review docs',
      outcome: 'done',
      summary: 'Updated docs.',
      steps: 1,
      traceFile: '/tmp/trace.json',
      events: [],
    },
  ],
};

const turnReview: ChatTurnReview = {
  traceFile: '/tmp/trace.json',
  files: [],
  reviewCommands: [],
  verificationCommands: [],
  mutationCommands: [],
  approvals: [],
};

describe('useSessionsScreenState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchChatSessionDetail).mockResolvedValue(sessionDetail);
    vi.mocked(fetchSessionRunningState).mockResolvedValue({ running: false });
    vi.mocked(fetchChatTurnReview).mockResolvedValue(turnReview);
    vi.mocked(continueChatSession).mockResolvedValue({
      outcome: 'done',
      summary: 'Continued.',
      session: sessionDetail,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('does not refetch session detail on every state render when parent callbacks are recreated', async () => {
    render(<SessionsStateHarness />);

    await waitFor(() => {
      expect(screen.getByTestId('messages').textContent).toBe('1');
    });
    await new Promise((resolve) => window.setTimeout(resolve, 80));

    expect(fetchChatSessionDetail).toHaveBeenCalledTimes(1);
    expect(fetchSessionRunningState).toHaveBeenCalledTimes(1);
    expect(fetchChatTurnReview).toHaveBeenCalledTimes(1);
  });

  it('keeps the optimistic user prompt visible while assistant text streams', async () => {
    let eventHandler: Parameters<typeof subscribeToChatSessionEvents>[1] | undefined;
    vi.mocked(subscribeToChatSessionEvents).mockImplementation((_sessionId, onUpdate) => {
      eventHandler = onUpdate;
      return () => undefined;
    });
    vi.mocked(sendChatSessionPrompt).mockReturnValue(new Promise(() => undefined) as ReturnType<typeof sendChatSessionPrompt>);

    render(<SessionsSendHarness />);

    await waitFor(() => {
      expect(screen.getByTestId('messages').textContent).toContain('Loaded.');
    });

    fireEvent.click(screen.getByRole('button', { name: 'send' }));

    await waitFor(() => {
      expect(screen.getByTestId('messages').textContent).toContain('What changed?');
    });

    act(() => {
      eventHandler?.({
        type: 'session.event',
        sessionId: 'session-1',
        event: {
          type: 'assistant.stream',
          text: 'Inspecting the repo…',
          done: false,
        },
      });
    });

    await waitFor(() => {
      const text = screen.getByTestId('messages').textContent ?? '';
      expect(text).toContain('What changed?');
      expect(text).toContain('Inspecting the repo…');
    });
  });

  it('keeps the optimistic user prompt visible across silent session refreshes', async () => {
    let eventHandler: Parameters<typeof subscribeToChatSessionEvents>[1] | undefined;
    vi.mocked(subscribeToChatSessionEvents).mockImplementation((_sessionId, onUpdate) => {
      eventHandler = onUpdate;
      return () => undefined;
    });
    vi.mocked(sendChatSessionPrompt).mockReturnValue(new Promise(() => undefined) as ReturnType<typeof sendChatSessionPrompt>);

    render(<SessionsSendHarness />);

    await waitFor(() => {
      expect(screen.getByTestId('messages').textContent).toContain('Loaded.');
    });

    fireEvent.click(screen.getByRole('button', { name: 'send' }));

    await waitFor(() => {
      expect(screen.getByTestId('messages').textContent).toContain('What changed?');
    });

    act(() => {
      eventHandler?.({
        type: 'session.updated',
        sessionId: 'session-1',
      });
    });

    await waitFor(() => {
      expect(fetchChatSessionDetail).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      const text = screen.getByTestId('messages').textContent ?? '';
      expect(text).toContain('Loaded.');
      expect(text).toContain('What changed?');
      expect(text).toContain('Heddle is working…');
    });
  });

  it('continues the selected session through the shared continue mutation', async () => {
    render(<SessionsContinueHarness />);

    await waitFor(() => {
      expect(screen.getByTestId('messages').textContent).toContain('Loaded.');
    });

    fireEvent.click(screen.getByRole('button', { name: 'continue' }));

    await waitFor(() => {
      expect(continueChatSession).toHaveBeenCalledWith('session-1');
    });
  });
});

function SessionsStateHarness() {
  const [renderCount, setRenderCount] = useState(0);
  const state = useSessionsScreenState(
    [sessionSummary],
    undefined,
    () => undefined,
    {
      selectedSessionId: 'session-1',
      onSelectedSessionIdChange: () => undefined,
    },
  );

  useEffect(() => {
    if (!state.sessionDetail || renderCount >= 2) {
      return;
    }
    const timeout = window.setTimeout(() => setRenderCount((current) => current + 1), 0);
    return () => window.clearTimeout(timeout);
  }, [renderCount, state.sessionDetail]);

  return (
    <output data-testid="messages">
      {state.sessionDetail?.messages.length ?? 0}
    </output>
  );
}

function SessionsSendHarness() {
  const state = useSessionsScreenState(
    [sessionSummary],
    undefined,
    () => undefined,
    {
      selectedSessionId: 'session-1',
      onSelectedSessionIdChange: () => undefined,
    },
  );

  return (
    <>
      <output data-testid="messages">
        {state.sessionDetail?.messages.map((message) => message.text).join('\n') ?? ''}
      </output>
      <button type="button" onClick={() => void state.sendPrompt('What changed?')}>send</button>
    </>
  );
}

function SessionsContinueHarness() {
  const state = useSessionsScreenState(
    [sessionSummary],
    undefined,
    () => undefined,
    {
      selectedSessionId: 'session-1',
      onSelectedSessionIdChange: () => undefined,
    },
  );

  return (
    <>
      <output data-testid="messages">
        {state.sessionDetail?.messages.map((message) => message.text).join('\n') ?? ''}
      </output>
      <button type="button" onClick={() => void state.continueSession()}>continue</button>
    </>
  );
}
