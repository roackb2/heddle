import { useCallback, useEffect, type Dispatch, type SetStateAction } from 'react';
import {
  ConversationActivityProjector,
  type ConversationActivity,
  type ConversationActivityHandlerMap,
} from '@/core/chat/engine/live/index.js';
import type { ControlPlaneSessionDetail } from '@web/api/client';
import {
  SessionEventStreamController,
  type ControlPlaneSessionEventEnvelope,
} from '@web/controllers/session-events';
import { SessionMessageController } from '@web/controllers/session-messages';
import type { RefreshControlPlaneSession } from './useControlPlaneSessionLoader';

type UseControlPlaneSessionEventsArgs = {
  sessionId?: string;
  refresh: RefreshControlPlaneSession;
  setSession: Dispatch<SetStateAction<ControlPlaneSessionDetail>>;
  setRunning: Dispatch<SetStateAction<boolean>>;
  setLiveStatus: Dispatch<SetStateAction<string | undefined>>;
};

// Subscribes to the selected session's live event stream and applies only the
// web-v2 conversation state transitions that this interface currently renders.
export function useControlPlaneSessionEvents({
  sessionId,
  refresh,
  setSession,
  setRunning,
  setLiveStatus,
}: UseControlPlaneSessionEventsArgs) {
  const applySessionEvent = useCallback((event: ControlPlaneSessionEventEnvelope) => {
    if (event.type === 'waiting') {
      setLiveStatus('Waiting for the session event stream...');
      return;
    }

    if (event.type !== 'session.event') {
      return;
    }

    event.activities?.forEach((activity) => applySessionActivity(activity, {
      sessionId: event.sessionId,
      refresh,
      setLiveStatus,
      setRunning,
      setSession,
    }));
  }, [refresh, setLiveStatus, setRunning, setSession]);

  useEffect(() => {
    if (!sessionId) {
      setRunning(false);
      setLiveStatus(undefined);
      return;
    }

    return SessionEventStreamController.subscribe(sessionId, (event) => {
      if (event.type === 'session.updated') {
        void refresh(sessionId, { silent: true });
        return;
      }

      applySessionEvent(event);
    });
  }, [applySessionEvent, refresh, sessionId, setLiveStatus, setRunning]);
}

type SessionActivityContext = {
  sessionId: string;
  refresh: RefreshControlPlaneSession;
  setSession: Dispatch<SetStateAction<ControlPlaneSessionDetail>>;
  setRunning: Dispatch<SetStateAction<boolean>>;
  setLiveStatus: Dispatch<SetStateAction<string | undefined>>;
};

const sessionActivityHandlers = {
  'assistant.stream': (activity, { setSession, setLiveStatus }) => {
    setSession((current) => (
      SessionMessageController.upsertLiveAssistantMessage(
        current,
        activity.event.text,
        activity.event.done,
      )
    ));
    setLiveStatus(activity.event.done ? undefined : 'Receiving assistant response...');
  },
  'loop.started': (_activity, { setRunning, setLiveStatus }) => {
    setRunning(true);
    setLiveStatus('Run started...');
  },
  'loop.finished': (_activity, { sessionId, refresh, setRunning, setLiveStatus }) => {
    setRunning(false);
    setLiveStatus(undefined);
    void refresh(sessionId, { silent: true });
  },
  'tool.calling': (activity, { setLiveStatus }) => {
    setLiveStatus(`Working... running ${activity.derived?.kind === 'tool-summary' ? activity.derived.summary : activity.event.tool}${formatStep(activity.correlation.step)}`);
  },
  'tool.completed': (activity, { setLiveStatus }) => {
    setLiveStatus(`${activity.event.tool} finished in ${Math.round(activity.event.durationMs)}ms`);
  },
  'tool.approval_requested': (activity, { setLiveStatus }) => {
    setLiveStatus(`Approval requested for ${activity.derived?.kind === 'tool-summary' ? activity.derived.summary : activity.event.call.tool}`);
  },
  'run.finished': (_activity, { sessionId, refresh, setRunning, setLiveStatus }) => {
    setRunning(false);
    setLiveStatus(undefined);
    void refresh(sessionId, { silent: true });
  },
  'compaction.running': (activity, { setLiveStatus }) => {
    setLiveStatus(activity.event.archivePath ? `Compacting earlier history... ${activity.event.archivePath}` : 'Compacting earlier history...');
  },
  'compaction.failed': (activity, { setLiveStatus }) => {
    setLiveStatus(activity.event.error ? `Compaction failed: ${activity.event.error}` : 'Compaction failed.');
  },
  'compaction.finished': (activity, { setLiveStatus }) => {
    setLiveStatus(activity.event.summaryPath ? `Compaction finished. Summary: ${activity.event.summaryPath}` : 'Compaction finished.');
  },
} satisfies ConversationActivityHandlerMap<SessionActivityContext>;

function applySessionActivity(activity: ConversationActivity, context: SessionActivityContext) {
  ConversationActivityProjector.applyHandler({
    activity,
    handlers: sessionActivityHandlers,
    context,
  });
}

function formatStep(step: number | undefined): string {
  return typeof step === 'number' ? ` (step ${step})` : '';
}
