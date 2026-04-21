import { useCallback, useEffect, useMemo, useState } from 'react';
import type { TraceEvent } from '../../../../core/types';
import {
  continueChatSession,
  createChatSession,
  fetchChatSessionDetail,
  fetchChatTurnReview,
  fetchPendingSessionApproval,
  fetchSessionRunningState,
  resolvePendingSessionApproval,
  sendChatSessionPrompt,
  subscribeToChatSessionEvents,
  cancelChatSession,
  updateChatSessionSettings,
  type ChatSessionDetail,
  type ChatTurnReview,
  type ControlPlaneState,
  type PendingSessionApproval,
} from '../../../lib/api';
import type { ToastInput } from '../../../components/ui/use-toast';

export type InspectorTab = 'summary' | 'review';
export type SessionDetailValue = Exclude<ChatSessionDetail, null>;
export type SessionTurn = SessionDetailValue['turns'][number];

export type SessionWorkspaceState = {
  activeSession?: ControlPlaneState['sessions'][number];
  selectedSessionId?: string;
  setSelectedSessionId: (sessionId: string) => void;
  sessionDetail: ChatSessionDetail | null;
  sessionDetailLoading: boolean;
  sessionDetailError?: string;
  sendingPrompt: boolean;
  runInFlight: boolean;
  sendPromptError?: string;
  sendPrompt: (prompt: string) => Promise<void>;
  creatingSession: boolean;
  sessionNotice?: string;
  createSession: () => Promise<void>;
  continueSession: () => Promise<void>;
  cancelSessionRun: () => Promise<void>;
  updateSessionSettings: (settings: { model?: string; driftEnabled?: boolean }) => Promise<void>;
  pendingApproval: PendingSessionApproval;
  resolveApproval: (approved: boolean) => Promise<void>;
  selectedTurnId?: string;
  setSelectedTurnId: (turnId: string) => void;
  selectedTurn?: SessionTurn;
  turnReview: ChatTurnReview | null;
  turnReviewLoading: boolean;
  turnReviewError?: string;
  inspectorTab: InspectorTab;
  setInspectorTab: (tab: InspectorTab) => void;
};

export function useSessionWorkspace(
  sessions: ControlPlaneState['sessions'] | undefined,
  notify?: (toast: ToastInput) => void,
  onSessionsChanged?: () => void,
): SessionWorkspaceState {
  const [selectedSessionId, setSelectedSessionId] = useState<string | undefined>();
  const [selectedTurnId, setSelectedTurnId] = useState<string | undefined>();
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('review');
  const [sessionDetail, setSessionDetail] = useState<ChatSessionDetail | null>(null);
  const [sessionDetailLoading, setSessionDetailLoading] = useState(false);
  const [sessionDetailError, setSessionDetailError] = useState<string | undefined>();
  const [sendingPrompt, setSendingPrompt] = useState(false);
  const [sendPromptError, setSendPromptError] = useState<string | undefined>();
  const [turnReview, setTurnReview] = useState<ChatTurnReview | null>(null);
  const [turnReviewLoading, setTurnReviewLoading] = useState(false);
  const [turnReviewError, setTurnReviewError] = useState<string | undefined>();
  const [pendingApproval, setPendingApproval] = useState<PendingSessionApproval>(null);
  const [runInFlight, setRunInFlight] = useState(false);
  const [creatingSession, setCreatingSession] = useState(false);
  const [sessionNotice, setSessionNotice] = useState<string | undefined>();

  const appendPendingUserTurn = useCallback((prompt: string) => {
    setSessionDetail((current) => {
      if (!current) {
        return current;
      }

      const nextMessages = current.messages.filter((message) => (
        message.id !== 'live-user'
        && message.id !== 'live-assistant'
        && message.id !== 'live-run-status'
      ));
      return {
        ...current,
        messages: [
          ...nextMessages,
          {
            id: 'live-user',
            role: 'user',
            text: prompt,
          },
          {
            id: 'live-run-status',
            role: 'assistant',
            text: 'Heddle is working…',
            isStreaming: true,
            isPending: true,
          },
        ],
      };
    });
  }, []);

  const upsertLiveStatusMessage = useCallback((id: string, text: string, options?: { pending?: boolean; streaming?: boolean }) => {
    setSessionDetail((current) => {
      if (!current) {
        return current;
      }

      const nextMessages = [...current.messages];
      const existingIndex = nextMessages.findIndex((message) => message.id === id);
      const nextMessage = {
        id,
        role: 'assistant' as const,
        text,
        isPending: options?.pending,
        isStreaming: options?.streaming,
      };

      if (existingIndex >= 0) {
        nextMessages[existingIndex] = nextMessage;
      } else {
        nextMessages.push(nextMessage);
      }

      return {
        ...current,
        messages: nextMessages,
      };
    });
  }, []);

  const removeLiveStatusMessage = useCallback((id: string) => {
    setSessionDetail((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        messages: current.messages.filter((message) => message.id !== id),
      };
    });
  }, []);

  const upsertLiveAssistantMessage = useCallback((text: string, isDone: boolean) => {
    setSessionDetail((current) => {
      if (!current) {
        return current;
      }

      const nextMessages = current.messages.filter((message) => message.id !== 'live-user' && message.id !== 'live-run-status');
      const lastMessage = nextMessages.at(-1);
      if (lastMessage?.id === 'live-assistant' && lastMessage.role === 'assistant') {
        nextMessages[nextMessages.length - 1] = {
          ...lastMessage,
          text,
          isStreaming: !isDone,
          isPending: !isDone,
        };
      } else {
        nextMessages.push({
          id: 'live-assistant',
          role: 'assistant',
          text,
          isStreaming: !isDone,
          isPending: !isDone,
        });
      }

      return {
        ...current,
        messages: nextMessages,
      };
    });
  }, []);

  useEffect(() => {
    if (!sessions?.length) {
      if (selectedSessionId && sessionDetail?.id === selectedSessionId) {
        return;
      }
      setSelectedSessionId(undefined);
      return;
    }

    if (selectedSessionId && sessionDetail?.id === selectedSessionId) {
      return;
    }

    if (!selectedSessionId || !sessions.some((session) => session.id === selectedSessionId)) {
      setSelectedSessionId(sessions[0].id);
    }
  }, [selectedSessionId, sessionDetail?.id, sessions]);

  const selectSession = useCallback((sessionId: string) => {
    setSelectedSessionId(sessionId);
    setSelectedTurnId(undefined);
    setInspectorTab('summary');
    setSessionNotice(undefined);
    setSendPromptError(undefined);
  }, []);

  useEffect(() => {
    if (!selectedSessionId) {
      setSessionDetail(null);
      setSessionDetailError(undefined);
      return;
    }

    const sessionId = selectedSessionId;
    let cancelled = false;
    let sessionUpdateTimeout: number | undefined;

    async function refresh(options: { silent?: boolean } = {}) {
      if (!options.silent) {
        setSessionDetailLoading(true);
      }
      try {
        const next = await fetchChatSessionDetail(sessionId);
        if (!cancelled) {
          setSessionDetail(next);
          setSessionDetailError(undefined);
        }
      } catch (refreshError) {
        if (!cancelled) {
          setSessionDetailError(refreshError instanceof Error ? refreshError.message : String(refreshError));
        }
      } finally {
        if (!cancelled && !options.silent) {
          setSessionDetailLoading(false);
        }
      }
    }

    void refresh();
    void fetchSessionRunningState(sessionId).then((state) => setRunInFlight(state.running));
    const unsubscribe = subscribeToChatSessionEvents(sessionId, (event) => {
      if (event.type === 'session.updated') {
        if (sessionUpdateTimeout !== undefined) {
          window.clearTimeout(sessionUpdateTimeout);
        }
        sessionUpdateTimeout = window.setTimeout(() => {
          void fetchSessionRunningState(sessionId).then((state) => {
            if (!cancelled) {
              setRunInFlight(state.running);
            }
          });
          void refresh({ silent: true });
          onSessionsChanged?.();
        }, 300);
        return;
      }

      if (event.type !== 'session.event' || !event.event || typeof event.event !== 'object') {
        return;
      }

      const liveEvent = event.event as {
        type?: string;
        text?: string;
        done?: boolean;
        tool?: string;
        step?: number;
        durationMs?: number;
        outcome?: string;
        summary?: string;
        event?: TraceEvent;
        status?: 'running' | 'finished' | 'failed';
        archivePath?: string;
        summaryPath?: string;
        error?: string;
      };

      if (liveEvent.status === 'running') {
        upsertLiveStatusMessage(
          'live-run-status',
          liveEvent.archivePath ? `Compacting earlier history… ${liveEvent.archivePath}` : 'Compacting earlier history…',
          { pending: true, streaming: false },
        );
        return;
      }

      if (liveEvent.status === 'failed') {
        upsertLiveStatusMessage(
          'live-run-status',
          liveEvent.error ? `Compaction failed: ${liveEvent.error}` : 'Compaction failed.',
          { pending: false, streaming: false },
        );
        return;
      }

      if (liveEvent.status === 'finished') {
        upsertLiveStatusMessage(
          'live-run-status',
          liveEvent.summaryPath ? `Compaction finished. Summary: ${liveEvent.summaryPath}` : 'Compaction finished.',
          { pending: false, streaming: false },
        );
        return;
      }

      if (liveEvent.type === 'loop.started') {
        setRunInFlight(true);
        upsertLiveStatusMessage('live-run-status', 'Run started…', { pending: true, streaming: true });
        return;
      }

      if (liveEvent.type === 'tool.calling' && typeof liveEvent.tool === 'string') {
        upsertLiveStatusMessage(
          'live-run-status',
          `Working… running ${liveEvent.tool}${typeof liveEvent.step === 'number' ? ` (step ${liveEvent.step})` : ''}`,
          { pending: true, streaming: true },
        );
        return;
      }

      if (liveEvent.type === 'tool.completed' && typeof liveEvent.tool === 'string') {
        upsertLiveStatusMessage(
          'live-run-status',
          `${liveEvent.tool} finished${typeof liveEvent.durationMs === 'number' ? ` in ${Math.round(liveEvent.durationMs)}ms` : ''}`,
          { pending: false, streaming: false },
        );
        return;
      }

      if (liveEvent.type === 'trace' && liveEvent.event) {
        const traceEvent = liveEvent.event;
        if (traceEvent.type === 'tool.approval_requested') {
          void fetchPendingSessionApproval(sessionId).then((approval) => setPendingApproval(approval));
          upsertLiveStatusMessage(
            'live-run-status',
            `Approval requested for ${traceEvent.call.tool}${typeof traceEvent.step === 'number' ? ` (step ${traceEvent.step})` : ''}`,
            { pending: true, streaming: false },
          );
          return;
        }

        if (traceEvent.type === 'tool.approval_resolved') {
          setPendingApproval(null);
          upsertLiveStatusMessage(
            'live-run-status',
            `Approval ${traceEvent.approved ? 'granted' : 'denied'} for ${traceEvent.call.tool}${traceEvent.reason ? ` — ${traceEvent.reason}` : ''}`,
            { pending: false, streaming: false },
          );
          return;
        }

        if (traceEvent.type === 'tool.fallback') {
          upsertLiveStatusMessage(
            'live-run-status',
            `Fallback: ${traceEvent.fromCall.tool} → ${traceEvent.toCall.tool}`,
            { pending: true, streaming: false },
          );
          return;
        }
      }

      if (liveEvent.type === 'assistant.stream' && typeof liveEvent.text === 'string') {
        upsertLiveAssistantMessage(liveEvent.text, Boolean(liveEvent.done));
        if (liveEvent.done) {
          removeLiveStatusMessage('live-run-status');
        }
        return;
      }

      if (liveEvent.type === 'loop.finished') {
        setRunInFlight(false);
        removeLiveStatusMessage('live-run-status');
        void refresh();
      }
    });

    return () => {
      cancelled = true;
      if (sessionUpdateTimeout !== undefined) {
        window.clearTimeout(sessionUpdateTimeout);
      }
      unsubscribe();
    };
  }, [
    removeLiveStatusMessage,
    onSessionsChanged,
    selectedSessionId,
    upsertLiveAssistantMessage,
    upsertLiveStatusMessage,
  ]);

  useEffect(() => {
    const latestTurnId = sessionDetail?.turns.at(-1)?.id;
    if (!sessionDetail) {
      setSelectedTurnId(undefined);
      return;
    }
    if (!latestTurnId) {
      setSelectedTurnId(undefined);
      return;
    }
    if (!selectedTurnId || !sessionDetail.turns.some((turn) => turn.id === selectedTurnId)) {
      setSelectedTurnId(latestTurnId);
    }
  }, [selectedTurnId, sessionDetail]);

  useEffect(() => {
    if (!sessionDetail?.id || !selectedTurnId) {
      setTurnReview(null);
      setTurnReviewError(undefined);
      return;
    }

    const sessionId = sessionDetail.id;
    const turnId = selectedTurnId;
    let cancelled = false;
    setTurnReviewLoading(true);

    async function refresh() {
      try {
        const next = await fetchChatTurnReview(sessionId, turnId);
        if (!cancelled) {
          setTurnReview(next);
          setTurnReviewError(undefined);
        }
      } catch (refreshError) {
        if (!cancelled) {
          setTurnReviewError(refreshError instanceof Error ? refreshError.message : String(refreshError));
        }
      } finally {
        if (!cancelled) {
          setTurnReviewLoading(false);
        }
      }
    }

    void refresh();

    return () => {
      cancelled = true;
    };
  }, [selectedTurnId, sessionDetail?.id, sessionDetail?.turns]);

  const activeSession = useMemo(
    () => sessions?.find((session) => session.id === selectedSessionId),
    [selectedSessionId, sessions],
  );
  const selectedTurn = useMemo(
    () => sessionDetail?.turns.find((turn) => turn.id === selectedTurnId) ?? sessionDetail?.turns.at(-1),
    [selectedTurnId, sessionDetail],
  );

  const resolveApproval = useCallback(async (approved: boolean) => {
    if (!selectedSessionId || !pendingApproval) {
      return;
    }

    try {
      await resolvePendingSessionApproval(
        selectedSessionId,
        approved,
        approved ? 'Approved in web control plane' : 'Denied in web control plane',
      );
      setPendingApproval(null);
      notify?.({
        title: approved ? 'Approval granted' : 'Approval denied',
        body: pendingApproval.tool,
        tone: approved ? 'success' : 'info',
      });
    } catch (error) {
      notify?.({
        title: 'Approval failed',
        body: error instanceof Error ? error.message : String(error),
        tone: 'error',
      });
    }
  }, [notify, pendingApproval, selectedSessionId]);

  const createSession = useCallback(async () => {
    setCreatingSession(true);
    setSessionNotice('Creating a new session…');
    try {
      const created = await createChatSession();
      setSelectedSessionId(created.id);
      setSessionDetail(created);
      setSelectedTurnId(undefined);
      setTurnReview(null);
      setPendingApproval(null);
      setRunInFlight(false);
      setSendPromptError(undefined);
      setSessionDetailError(undefined);
      setSessionNotice(`Created ${created.name}. Ready for a fresh prompt.`);
      notify?.({
        title: 'Session created',
        body: `${created.name} is ready for a fresh prompt.`,
        tone: 'success',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSessionNotice(message);
      notify?.({
        title: 'Session creation failed',
        body: message,
        tone: 'error',
      });
    } finally {
      setCreatingSession(false);
    }
  }, [notify]);

  const sendPrompt = useCallback(async (prompt: string) => {
    const trimmed = prompt.trim();
    if (!selectedSessionId || !trimmed || sendingPrompt) {
      return;
    }

    setSendingPrompt(true);
    setRunInFlight(true);
    setSendPromptError(undefined);
    appendPendingUserTurn(trimmed);
    try {
      const result = await sendChatSessionPrompt(selectedSessionId, trimmed);
      setSessionDetail(result.session);
      const latestTurnId = result.session?.turns.at(-1)?.id;
      if (latestTurnId) {
        setSelectedTurnId(latestTurnId);
      }
      setRunInFlight(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSendPromptError(message);
      setRunInFlight(false);
      notify?.({
        title: 'Send failed',
        body: message,
        tone: 'error',
      });
    } finally {
      setSendingPrompt(false);
    }
  }, [appendPendingUserTurn, notify, selectedSessionId, sendingPrompt]);

  const continueSession = useCallback(async () => {
    if (!selectedSessionId || sendingPrompt || runInFlight) {
      return;
    }

    setSendingPrompt(true);
    setRunInFlight(true);
    setSendPromptError(undefined);
    upsertLiveStatusMessage('live-run-status', 'Continuing from the current transcript…', { pending: true, streaming: true });

    try {
      const result = await continueChatSession(selectedSessionId);
      setSessionDetail(result.session);
      const latestTurnId = result.session?.turns.at(-1)?.id;
      if (latestTurnId) {
        setSelectedTurnId(latestTurnId);
      }
      setPendingApproval(await fetchPendingSessionApproval(selectedSessionId));
      setRunInFlight(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSendPromptError(message);
      setRunInFlight(false);
      notify?.({
        title: 'Continue failed',
        body: message,
        tone: 'error',
      });
      removeLiveStatusMessage('live-run-status');
      setSessionDetail((current) => {
        if (!current) {
          return current;
        }
        return {
          ...current,
          messages: current.messages.filter((message) => message.id !== 'live-assistant'),
        };
      });
    } finally {
      setSendingPrompt(false);
    }
  }, [notify, removeLiveStatusMessage, runInFlight, selectedSessionId, sendingPrompt, upsertLiveStatusMessage]);

  const cancelSessionRun = useCallback(async () => {
    if (!selectedSessionId || !runInFlight) {
      return;
    }

    try {
      const result = await cancelChatSession(selectedSessionId);
      setRunInFlight(false);
      setPendingApproval(null);
      removeLiveStatusMessage('live-run-status');
      setSendPromptError(undefined);
      setSessionDetail((current) => {
        if (!current) {
          return current;
        }
        return {
          ...current,
          messages: current.messages.filter((message) => message.id !== 'live-user' && message.id !== 'live-assistant'),
        };
      });
      notify?.({
        title: result.cancelled ? 'Run cancelled' : 'No active run to cancel',
        body: result.cancelled ? 'The active session run was interrupted.' : undefined,
        tone: result.cancelled ? 'success' : 'info',
      });
    } catch (error) {
      notify?.({
        title: 'Cancel failed',
        body: error instanceof Error ? error.message : String(error),
        tone: 'error',
      });
    }
  }, [notify, removeLiveStatusMessage, runInFlight, selectedSessionId]);

  const updateSessionSettings = useCallback(async (settings: { model?: string; driftEnabled?: boolean }) => {
    if (!selectedSessionId || runInFlight || sendingPrompt) {
      return;
    }

    try {
      const updated = await updateChatSessionSettings(selectedSessionId, settings);
      setSessionDetail(updated);
      notify?.({
        title: 'Session settings updated',
        body: [
          settings.model ? `model ${settings.model}` : undefined,
          typeof settings.driftEnabled === 'boolean' ? `drift ${settings.driftEnabled ? 'on' : 'off'}` : undefined,
        ].filter(Boolean).join(', '),
        tone: 'success',
      });
    } catch (error) {
      notify?.({
        title: 'Settings update failed',
        body: error instanceof Error ? error.message : String(error),
        tone: 'error',
      });
    }
  }, [notify, runInFlight, selectedSessionId, sendingPrompt]);

  return {
    activeSession,
    selectedSessionId,
    setSelectedSessionId: selectSession,
    sessionDetail,
    sessionDetailLoading,
    sessionDetailError,
    sendingPrompt,
    runInFlight,
    sendPromptError,
    sendPrompt,
    creatingSession,
    sessionNotice,
    createSession,
    continueSession,
    cancelSessionRun,
    updateSessionSettings,
    pendingApproval,
    resolveApproval,
    selectedTurnId,
    setSelectedTurnId,
    selectedTurn,
    turnReview,
    turnReviewLoading,
    turnReviewError,
    inspectorTab,
    setInspectorTab,
  };
}
