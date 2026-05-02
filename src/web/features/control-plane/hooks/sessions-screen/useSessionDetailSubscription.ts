import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import {
  applyConversationActivityHandler,
  projectAgentLoopEventToConversationActivities,
  projectCompactionStatusToConversationActivities,
  type ConversationActivity,
  type ConversationActivityHandlerMap,
  type ConversationCompactionStatus,
} from '../../../../../core/observability/conversation-activity';
import type { AgentLoopEvent } from '../../../../../core/runtime/events';
import type { TraceEvent } from '../../../../../core/types';
import {
  fetchChatSessionDetail,
  fetchPendingSessionApproval,
  fetchSessionRunningState,
  subscribeToChatSessionEvents,
  type ChatSessionDetail,
  type PendingSessionApproval,
} from '../../../../lib/api';
import { mergeTransientMessages } from './useLiveSessionMessages';

type LiveSessionMessageActions = {
  upsertLiveStatusMessage: (id: string, text: string, options?: { pending?: boolean; streaming?: boolean }) => void;
  removeLiveStatusMessage: (id: string) => void;
  upsertLiveAssistantMessage: (text: string, isDone: boolean) => void;
};

type LiveSessionEvent = {
  type?: string;
  text?: string;
  done?: boolean;
  tool?: string;
  step?: number;
  durationMs?: number;
  event?: TraceEvent;
  status?: 'running' | 'finished' | 'failed';
  archivePath?: string;
  summaryPath?: string;
  error?: string;
};

type SessionEventContext = {
  sessionId: string;
  setRunInFlight: Dispatch<SetStateAction<boolean>>;
  setMemoryUpdating: Dispatch<SetStateAction<boolean>>;
  setPendingApproval: Dispatch<SetStateAction<PendingSessionApproval>>;
  refresh: (options?: { silent?: boolean }) => Promise<void>;
  liveMessages: LiveSessionMessageActions;
};

export function useSessionDetailSubscription({
  selectedSessionId,
  setSessionDetail,
  setSessionDetailLoading,
  setSessionDetailError,
  setRunInFlight,
  setMemoryUpdating,
  setPendingApproval,
  onSessionsChanged,
  liveMessages,
}: {
  selectedSessionId?: string;
  setSessionDetail: Dispatch<SetStateAction<ChatSessionDetail | null>>;
  setSessionDetailLoading: Dispatch<SetStateAction<boolean>>;
  setSessionDetailError: Dispatch<SetStateAction<string | undefined>>;
  setRunInFlight: Dispatch<SetStateAction<boolean>>;
  setMemoryUpdating: Dispatch<SetStateAction<boolean>>;
  setPendingApproval: Dispatch<SetStateAction<PendingSessionApproval>>;
  onSessionsChanged?: () => void;
  liveMessages: LiveSessionMessageActions;
}) {
  const onSessionsChangedRef = useRef(onSessionsChanged);

  useEffect(() => {
    onSessionsChangedRef.current = onSessionsChanged;
  }, [onSessionsChanged]);

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
          setSessionDetail((current) => options.silent ? mergeTransientMessages(current, next) : next);
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
          onSessionsChangedRef.current?.();
        }, 300);
        return;
      }

      if (event.type !== 'session.event' || !event.event || typeof event.event !== 'object') {
        return;
      }

      handleSessionEvent({
        sessionId,
        liveEvent: event.event,
        setRunInFlight,
        setMemoryUpdating,
        setPendingApproval,
        refresh,
        liveMessages,
      });
    });

    return () => {
      cancelled = true;
      if (sessionUpdateTimeout !== undefined) {
        window.clearTimeout(sessionUpdateTimeout);
      }
      unsubscribe();
    };
  }, [
    liveMessages,
    selectedSessionId,
    setMemoryUpdating,
    setPendingApproval,
    setRunInFlight,
    setSessionDetail,
    setSessionDetailError,
    setSessionDetailLoading,
  ]);
}

function handleSessionEvent({
  sessionId,
  liveEvent,
  setRunInFlight,
  setMemoryUpdating,
  setPendingApproval,
  refresh,
  liveMessages,
}: {
  sessionId: string;
  liveEvent: unknown;
  setRunInFlight: Dispatch<SetStateAction<boolean>>;
  setMemoryUpdating: Dispatch<SetStateAction<boolean>>;
  setPendingApproval: Dispatch<SetStateAction<PendingSessionApproval>>;
  refresh: (options?: { silent?: boolean }) => Promise<void>;
  liveMessages: LiveSessionMessageActions;
}) {
  const event = liveEvent as LiveSessionEvent;
  const context: SessionEventContext = {
    sessionId,
    setRunInFlight,
    setMemoryUpdating,
    setPendingApproval,
    refresh,
    liveMessages,
  };
  projectLiveSessionEvent(event).forEach((activity) => applyWebConversationActivity(activity, context));
}

const webActivityHandlers = {
  'compaction.running': (activity, { liveMessages }) => {
    liveMessages.upsertLiveStatusMessage(
      'live-run-status',
      activity.archivePath ? `Compacting earlier history… ${activity.archivePath}` : 'Compacting earlier history…',
      { pending: true, streaming: false },
    );
  },
  'compaction.failed': (activity, { liveMessages }) => {
    liveMessages.upsertLiveStatusMessage(
      'live-run-status',
      activity.error ? `Compaction failed: ${activity.error}` : 'Compaction failed.',
      { pending: false, streaming: false },
    );
  },
  'compaction.finished': (activity, { liveMessages }) => {
    liveMessages.upsertLiveStatusMessage(
      'live-run-status',
      activity.summaryPath ? `Compaction finished. Summary: ${activity.summaryPath}` : 'Compaction finished.',
      { pending: false, streaming: false },
    );
  },
  'loop.started': (_activity, { setRunInFlight, liveMessages }) => {
    setRunInFlight(true);
    liveMessages.upsertLiveStatusMessage('live-run-status', 'Run started…', { pending: true, streaming: true });
  },
  'tool.calling': (activity, { liveMessages }) => {
    liveMessages.upsertLiveStatusMessage(
      'live-run-status',
      `Working… running ${activity.tool}${typeof activity.step === 'number' ? ` (step ${activity.step})` : ''}`,
      { pending: true, streaming: true },
    );
  },
  'tool.completed': (activity, { liveMessages }) => {
    liveMessages.upsertLiveStatusMessage(
      'live-run-status',
      `${activity.tool} finished${typeof activity.durationMs === 'number' ? ` in ${Math.round(activity.durationMs)}ms` : ''}`,
      { pending: false, streaming: false },
    );
  },
  'assistant.stream': (activity, { liveMessages }) => {
    liveMessages.upsertLiveAssistantMessage(activity.text, activity.done);
    if (activity.done) {
      liveMessages.removeLiveStatusMessage('live-run-status');
    }
  },
  'loop.finished': (_activity, { setRunInFlight, liveMessages, refresh }) => {
    setRunInFlight(false);
    liveMessages.removeLiveStatusMessage('live-run-status');
    void refresh();
  },
  'memory.maintenance_started': (activity, { setMemoryUpdating, liveMessages }) => {
    setMemoryUpdating(true);
    liveMessages.upsertLiveStatusMessage(
      'live-run-status',
      `Memory updating… ${activity.candidateCount} candidate${activity.candidateCount === 1 ? '' : 's'}`,
      { pending: true, streaming: false },
    );
  },
  'memory.maintenance_finished': (activity, { setMemoryUpdating, liveMessages, refresh }) => {
    setMemoryUpdating(false);
    liveMessages.upsertLiveStatusMessage(
      'live-run-status',
      activity.summary ? `Memory updated. ${activity.summary}` : 'Memory updated.',
      { pending: false, streaming: false },
    );
    void refresh({ silent: true });
  },
  'memory.maintenance_failed': (activity, { setMemoryUpdating, liveMessages }) => {
    setMemoryUpdating(false);
    liveMessages.upsertLiveStatusMessage(
      'live-run-status',
      activity.error ? `Memory update failed: ${activity.error}` : 'Memory update failed.',
      { pending: false, streaming: false },
    );
  },
  'tool.approval_requested': (activity, { sessionId, setPendingApproval, liveMessages }) => {
    void fetchPendingSessionApproval(sessionId).then((approval) => setPendingApproval(approval));
    liveMessages.upsertLiveStatusMessage(
      'live-run-status',
      `Approval requested for ${activity.tool}${typeof activity.step === 'number' ? ` (step ${activity.step})` : ''}`,
      { pending: true, streaming: false },
    );
  },
  'tool.approval_resolved': (activity, { setPendingApproval, liveMessages }) => {
    setPendingApproval(null);
    liveMessages.upsertLiveStatusMessage(
      'live-run-status',
      `Approval ${activity.approved ? 'granted' : 'denied'} for ${activity.tool}${activity.reason ? ` — ${activity.reason}` : ''}`,
      { pending: false, streaming: false },
    );
  },
  'tool.fallback': (activity, { liveMessages }) => {
    liveMessages.upsertLiveStatusMessage(
      'live-run-status',
      `Fallback: ${activity.fromTool} → ${activity.toTool}`,
      { pending: true, streaming: false },
    );
  },
} satisfies ConversationActivityHandlerMap<SessionEventContext>;

function projectLiveSessionEvent(event: LiveSessionEvent): ConversationActivity[] {
  if (isCompactionStatusEvent(event)) {
    return projectCompactionStatusToConversationActivities(event);
  }

  return isAgentLoopEventLike(event) ? projectAgentLoopEventToConversationActivities(event) : [];
}

function applyWebConversationActivity(activity: ConversationActivity, context: SessionEventContext) {
  applyConversationActivityHandler(activity, webActivityHandlers, context);
}

function isCompactionStatusEvent(event: LiveSessionEvent): event is ConversationCompactionStatus {
  return event.status === 'running' || event.status === 'finished' || event.status === 'failed';
}

function isAgentLoopEventLike(event: LiveSessionEvent): event is AgentLoopEvent {
  return typeof event.type === 'string';
}
