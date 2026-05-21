import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import {
  ConversationActivityProjector,
  type ConversationActivity,
  type ConversationActivityHandlerMap,
} from '../../../../../core/chat/engine/live';
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

      if (event.type !== 'session.event') {
        return;
      }

      handleSessionEvent({
        sessionId,
        activities: event.activities ?? [],
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
  activities,
  setRunInFlight,
  setMemoryUpdating,
  setPendingApproval,
  refresh,
  liveMessages,
}: {
  sessionId: string;
  activities: unknown[];
  setRunInFlight: Dispatch<SetStateAction<boolean>>;
  setMemoryUpdating: Dispatch<SetStateAction<boolean>>;
  setPendingApproval: Dispatch<SetStateAction<PendingSessionApproval>>;
  refresh: (options?: { silent?: boolean }) => Promise<void>;
  liveMessages: LiveSessionMessageActions;
}) {
  const context: SessionEventContext = {
    sessionId,
    setRunInFlight,
    setMemoryUpdating,
    setPendingApproval,
    refresh,
    liveMessages,
  };
  activities.forEach((activity) => applyWebConversationActivity(activity as ConversationActivity, context));
}

const webActivityHandlers = {
  'compaction.running': (activity, { liveMessages }) => {
    liveMessages.upsertLiveStatusMessage(
      'live-run-status',
      activity.event.archivePath ? `Compacting earlier history… ${activity.event.archivePath}` : 'Compacting earlier history…',
      { pending: true, streaming: false },
    );
  },
  'compaction.failed': (activity, { liveMessages }) => {
    liveMessages.upsertLiveStatusMessage(
      'live-run-status',
      activity.event.error ? `Compaction failed: ${activity.event.error}` : 'Compaction failed.',
      { pending: false, streaming: false },
    );
  },
  'compaction.finished': (activity, { liveMessages }) => {
    liveMessages.upsertLiveStatusMessage(
      'live-run-status',
      activity.event.summaryPath ? `Compaction finished. Summary: ${activity.event.summaryPath}` : 'Compaction finished.',
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
      `Working… running ${activity.event.tool}${typeof activity.correlation.step === 'number' ? ` (step ${activity.correlation.step})` : ''}`,
      { pending: true, streaming: true },
    );
  },
  'tool.completed': (activity, { liveMessages }) => {
    liveMessages.upsertLiveStatusMessage(
      'live-run-status',
      `${activity.event.tool} finished in ${Math.round(activity.event.durationMs)}ms`,
      { pending: false, streaming: false },
    );
  },
  'assistant.stream': (activity, { liveMessages }) => {
    liveMessages.upsertLiveAssistantMessage(activity.event.text, activity.event.done);
    if (activity.event.done) {
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
      `Memory updating… ${activity.event.candidateIds.length} candidate${activity.event.candidateIds.length === 1 ? '' : 's'}`,
      { pending: true, streaming: false },
    );
  },
  'memory.maintenance_finished': (activity, { setMemoryUpdating, liveMessages, refresh }) => {
    setMemoryUpdating(false);
    liveMessages.upsertLiveStatusMessage(
      'live-run-status',
      activity.event.summary ? `Memory updated. ${activity.event.summary}` : 'Memory updated.',
      { pending: false, streaming: false },
    );
    void refresh({ silent: true });
  },
  'memory.maintenance_failed': (activity, { setMemoryUpdating, liveMessages }) => {
    setMemoryUpdating(false);
    liveMessages.upsertLiveStatusMessage(
      'live-run-status',
      activity.event.error ? `Memory update failed: ${activity.event.error}` : 'Memory update failed.',
      { pending: false, streaming: false },
    );
  },
  'tool.approval_requested': (activity, { sessionId, setPendingApproval, liveMessages }) => {
    void fetchPendingSessionApproval(sessionId).then((approval) => setPendingApproval(approval));
    liveMessages.upsertLiveStatusMessage(
      'live-run-status',
      `Approval requested for ${activity.event.call.tool}${typeof activity.correlation.step === 'number' ? ` (step ${activity.correlation.step})` : ''}`,
      { pending: true, streaming: false },
    );
  },
  'tool.approval_resolved': (activity, { setPendingApproval, liveMessages }) => {
    setPendingApproval(null);
    liveMessages.upsertLiveStatusMessage(
      'live-run-status',
      `Approval ${activity.event.approved ? 'granted' : 'denied'} for ${activity.event.call.tool}${activity.event.reason ? ` — ${activity.event.reason}` : ''}`,
      { pending: false, streaming: false },
    );
  },
  'tool.fallback': (activity, { liveMessages }) => {
    liveMessages.upsertLiveStatusMessage(
      'live-run-status',
      `Fallback: ${activity.event.fromCall.tool} → ${activity.event.toCall.tool}`,
      { pending: true, streaming: false },
    );
  },
} satisfies ConversationActivityHandlerMap<SessionEventContext>;

function applyWebConversationActivity(activity: ConversationActivity, context: SessionEventContext) {
  ConversationActivityProjector.applyHandler({
    activity,
    handlers: webActivityHandlers,
    context,
  });
}
