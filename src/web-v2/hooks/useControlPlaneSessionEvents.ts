import { useCallback, useEffect, type Dispatch, type SetStateAction } from 'react';
import type { ControlPlaneSessionDetail } from '@web/api/client';
import {
  SessionLiveEventPresenter,
  SessionEventStreamController,
  type ControlPlaneSessionEventEnvelope,
  type LiveSessionEvent,
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

    if (event.type !== 'session.event' || !event.event || typeof event.event !== 'object') {
      return;
    }

    const viewUpdate = SessionLiveEventPresenter.present(event.event as LiveSessionEvent);
    if (viewUpdate.assistantText !== undefined) {
      setSession((current) => (
        SessionMessageController.upsertLiveAssistantMessage(
          current,
          viewUpdate.assistantText ?? '',
          viewUpdate.assistantDone,
        )
      ));
    }
    if (viewUpdate.status !== undefined) {
      setLiveStatus(viewUpdate.status ?? undefined);
    }
    if (viewUpdate.running !== undefined) {
      setRunning(viewUpdate.running);
    }
    if (viewUpdate.refresh) {
      setLiveStatus(undefined);
      void refresh(event.sessionId, { silent: true });
    }
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
