import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
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

type SessionEventHandler = {
  matches: (event: LiveSessionEvent) => boolean;
  handle: (event: LiveSessionEvent, context: SessionEventContext) => void;
};

type TraceEventContext = Pick<SessionEventContext, 'sessionId' | 'setMemoryUpdating' | 'setPendingApproval' | 'refresh' | 'liveMessages'>;

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
  sessionEventHandlers.find((handler) => handler.matches(event))?.handle(event, context);
}

const compactionStatusHandlers: Record<NonNullable<LiveSessionEvent['status']>, (event: LiveSessionEvent, context: SessionEventContext) => void> = {
  running: (event, { liveMessages }) => {
    liveMessages.upsertLiveStatusMessage(
      'live-run-status',
      event.archivePath ? `Compacting earlier history… ${event.archivePath}` : 'Compacting earlier history…',
      { pending: true, streaming: false },
    );
  },
  failed: (event, { liveMessages }) => {
    liveMessages.upsertLiveStatusMessage(
      'live-run-status',
      event.error ? `Compaction failed: ${event.error}` : 'Compaction failed.',
      { pending: false, streaming: false },
    );
  },
  finished: (event, { liveMessages }) => {
    liveMessages.upsertLiveStatusMessage(
      'live-run-status',
      event.summaryPath ? `Compaction finished. Summary: ${event.summaryPath}` : 'Compaction finished.',
      { pending: false, streaming: false },
    );
  },
};

const eventTypeHandlers: Record<string, SessionEventHandler['handle']> = {
  'loop.started': (_event, { setRunInFlight, liveMessages }) => {
    setRunInFlight(true);
    liveMessages.upsertLiveStatusMessage('live-run-status', 'Run started…', { pending: true, streaming: true });
  },
  'tool.calling': (event, { liveMessages }) => {
    withStringValue(event.tool, (tool) => liveMessages.upsertLiveStatusMessage(
      'live-run-status',
      `Working… running ${tool}${typeof event.step === 'number' ? ` (step ${event.step})` : ''}`,
      { pending: true, streaming: true },
    ));
  },
  'tool.completed': (event, { liveMessages }) => {
    withStringValue(event.tool, (tool) => liveMessages.upsertLiveStatusMessage(
      'live-run-status',
      `${tool} finished${typeof event.durationMs === 'number' ? ` in ${Math.round(event.durationMs)}ms` : ''}`,
      { pending: false, streaming: false },
    ));
  },
  trace: (event, context) => {
    withValue(event.event, (traceEvent) => handleTraceEvent(traceEvent, context));
  },
  'assistant.stream': (event, { liveMessages }) => {
    withStringValue(event.text, (text) => liveMessages.upsertLiveAssistantMessage(text, Boolean(event.done)));
    when(Boolean(event.done), () => liveMessages.removeLiveStatusMessage('live-run-status'));
  },
  'loop.finished': (_event, { setRunInFlight, liveMessages, refresh }) => {
    setRunInFlight(false);
    liveMessages.removeLiveStatusMessage('live-run-status');
    void refresh();
  },
};

const sessionEventHandlers: SessionEventHandler[] = [
  {
    matches: (event) => Boolean(event.status && compactionStatusHandlers[event.status]),
    handle: (event, context) => event.status && compactionStatusHandlers[event.status](event, context),
  },
  {
    matches: (event) => Boolean(event.type && eventTypeHandlers[event.type]),
    handle: (event, context) => event.type && eventTypeHandlers[event.type](event, context),
  },
];

const traceEventHandlers: Partial<{
  [EventType in TraceEvent['type']]: (event: Extract<TraceEvent, { type: EventType }>, context: TraceEventContext) => void;
}> = {
  'memory.maintenance_started': (event, { setMemoryUpdating, liveMessages }) => {
    setMemoryUpdating(true);
    liveMessages.upsertLiveStatusMessage(
      'live-run-status',
      `Memory updating… ${event.candidateIds.length} candidate${event.candidateIds.length === 1 ? '' : 's'}`,
      { pending: true, streaming: false },
    );
  },
  'memory.maintenance_finished': (event, { setMemoryUpdating, liveMessages, refresh }) => {
    setMemoryUpdating(false);
    liveMessages.upsertLiveStatusMessage(
      'live-run-status',
      event.summary ? `Memory updated. ${event.summary}` : 'Memory updated.',
      { pending: false, streaming: false },
    );
    void refresh({ silent: true });
  },
  'memory.maintenance_failed': (event, { setMemoryUpdating, liveMessages }) => {
    setMemoryUpdating(false);
    liveMessages.upsertLiveStatusMessage(
      'live-run-status',
      event.error ? `Memory update failed: ${event.error}` : 'Memory update failed.',
      { pending: false, streaming: false },
    );
  },
  'tool.approval_requested': (event, { sessionId, setPendingApproval, liveMessages }) => {
    void fetchPendingSessionApproval(sessionId).then((approval) => setPendingApproval(approval));
    liveMessages.upsertLiveStatusMessage(
      'live-run-status',
      `Approval requested for ${event.call.tool}${typeof event.step === 'number' ? ` (step ${event.step})` : ''}`,
      { pending: true, streaming: false },
    );
  },
  'tool.approval_resolved': (event, { setPendingApproval, liveMessages }) => {
    setPendingApproval(null);
    liveMessages.upsertLiveStatusMessage(
      'live-run-status',
      `Approval ${event.approved ? 'granted' : 'denied'} for ${event.call.tool}${event.reason ? ` — ${event.reason}` : ''}`,
      { pending: false, streaming: false },
    );
  },
  'tool.fallback': (event, { liveMessages }) => {
    liveMessages.upsertLiveStatusMessage(
      'live-run-status',
      `Fallback: ${event.fromCall.tool} → ${event.toCall.tool}`,
      { pending: true, streaming: false },
    );
  },
};

function handleTraceEvent(traceEvent: TraceEvent, context: TraceEventContext) {
  const handler = traceEventHandlers[traceEvent.type] as ((event: TraceEvent, context: TraceEventContext) => void) | undefined;
  handler?.(traceEvent, context);
}

function withValue<T>(value: T | undefined, callback: (value: T) => void) {
  if (value !== undefined) {
    callback(value);
  }
}

function withStringValue(value: unknown, callback: (value: string) => void) {
  if (typeof value === 'string') {
    callback(value);
  }
}

function when(condition: boolean, callback: () => void) {
  if (condition) {
    callback();
  }
}
