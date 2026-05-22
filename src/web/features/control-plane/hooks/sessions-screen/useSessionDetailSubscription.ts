import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import type { ConversationActivity, ConversationActivityHandlerMap } from '../../../../../core/live';
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

      applySessionActivities({
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

function applySessionActivities({
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
  activities.forEach((activity) => applySessionActivity(activity as ConversationActivity, context));
}

const sessionActivityHandlers: ConversationActivityHandlerMap<SessionEventContext> = {
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
      `${activity.tool} finished in ${Math.round(activity.durationMs)}ms`,
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
  'tool.approval_requested': (activity, { sessionId, setPendingApproval, liveMessages }) => {
    void fetchPendingSessionApproval(sessionId).then((approval) => setPendingApproval(approval));
    liveMessages.upsertLiveStatusMessage(
      'live-run-status',
      `Approval requested for ${activity.call.tool}${typeof activity.step === 'number' ? ` (step ${activity.step})` : ''}`,
      { pending: true, streaming: false },
    );
  },
  'tool.approval_resolved': (activity, { setPendingApproval, liveMessages }) => {
    setPendingApproval(null);
    liveMessages.upsertLiveStatusMessage(
      'live-run-status',
      `Approval ${activity.approved ? 'granted' : 'denied'} for ${activity.call.tool}${activity.reason ? ` — ${activity.reason}` : ''}`,
      { pending: false, streaming: false },
    );
  },
  'tool.fallback': (activity, { liveMessages }) => {
    liveMessages.upsertLiveStatusMessage(
      'live-run-status',
      `Fallback: ${activity.fromCall.tool} → ${activity.toCall.tool}`,
      { pending: true, streaming: false },
    );
  },
};

function applySessionActivity(activity: ConversationActivity, context: SessionEventContext) {
  const handler = sessionActivityHandlers[activity.type] as ((activity: ConversationActivity, context: SessionEventContext) => void) | undefined;
  handler?.(activity, context);
}
