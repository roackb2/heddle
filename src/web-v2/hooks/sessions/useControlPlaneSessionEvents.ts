import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { skipToken } from '@tanstack/react-query';
import {
  trpcReact,
  type ControlPlaneSessionDetail,
  type ControlPlaneSessionEventEnvelope,
} from '@web/api/client';
import { ClientSharedSessionActivityService } from '@/client-shared/services/session-activities';
import { ClientSharedSessionMessageService } from '@/client-shared/services/session-messages';
import type { RefreshControlPlaneSession } from './useControlPlaneSessionLoader';

type UseControlPlaneSessionEventsArgs = {
  workspaceId?: string;
  sessionId?: string;
  refresh: RefreshControlPlaneSession;
  refreshPendingApproval: (sessionId: string) => void;
  setSession: Dispatch<SetStateAction<ControlPlaneSessionDetail>>;
  setRunning: Dispatch<SetStateAction<boolean>>;
  setLiveStatus: Dispatch<SetStateAction<string | undefined>>;
};

export type ControlPlaneSessionEventsState = {
  streamConnected: boolean;
};

// Subscribes to the selected session's live event stream and applies only the
// web-v2 conversation state transitions that this interface currently renders.
export function useControlPlaneSessionEvents({
  workspaceId,
  sessionId,
  refresh,
  refreshPendingApproval,
  setSession,
  setRunning,
  setLiveStatus,
}: UseControlPlaneSessionEventsArgs): ControlPlaneSessionEventsState {
  const utils = trpcReact.useUtils();
  const [streamConnected, setStreamConnected] = useState(false);
  const activeAddressRef = useRef<SessionAddress>({ workspaceId, sessionId });
  const invalidateWorkspaceDiff = useCallback(() => {
    void utils.controlPlane.workspaceChanges.invalidate(workspaceId ? { workspaceId } : undefined);
    void utils.controlPlane.workspaceFileDiff.invalidate();
  }, [utils, workspaceId]);
  const applySessionEvent = useCallback((event: ControlPlaneSessionEventEnvelope) => {
    if (!isActiveSessionAddress(activeAddressRef.current, { workspaceId, sessionId: event.sessionId })) {
      return;
    }

    if (event.type === 'waiting') {
      setLiveStatus('Waiting for the session event stream...');
      return;
    }

    if (event.type === 'session.updated') {
      void refresh(event.sessionId, { silent: true });
      return;
    }

    if (event.type !== 'session.event') {
      return;
    }

    event.activities?.forEach((activity) => applySessionActivity(activity, {
      sessionId: event.sessionId,
      refresh,
      refreshPendingApproval,
      invalidateWorkspaceDiff,
      updateSession: (updater) => {
        setSession(updater);
        if (workspaceId) {
          utils.controlPlane.session.setData(
            { id: event.sessionId, workspaceId },
            (current) => applySessionUpdate(current ?? null, updater),
          );
        }
      },
      setLiveStatus,
      setRunning,
    }));
  }, [invalidateWorkspaceDiff, refresh, refreshPendingApproval, setLiveStatus, setRunning, setSession, utils.controlPlane.session, workspaceId]);

  const subscription = trpcReact.controlPlane.sessionEvents.useSubscription(
    sessionId && workspaceId ? { sessionId, workspaceId } : skipToken,
    {
      onStarted: () => {
        setStreamConnected(true);
      },
      onData: applySessionEvent,
      onError: (error) => {
        setStreamConnected(false);
        setLiveStatus(error.message);
      },
      onComplete: () => {
        setStreamConnected(false);
      },
    },
  );

  useEffect(() => {
    activeAddressRef.current = { workspaceId, sessionId };
    if (!sessionId || !workspaceId) {
      setRunning(false);
      setLiveStatus(undefined);
      setStreamConnected(false);
      return;
    }

    setRunning(false);
    setLiveStatus(undefined);
  }, [sessionId, setLiveStatus, setRunning, workspaceId]);

  useEffect(() => {
    setStreamConnected(subscription.status === 'pending');
  }, [subscription.status]);

  return { streamConnected };
}

type SessionAddress = {
  workspaceId?: string;
  sessionId?: string;
};

function isActiveSessionAddress(active: SessionAddress, event: SessionAddress): boolean {
  return Boolean(
    active.workspaceId
    && active.sessionId
    && active.workspaceId === event.workspaceId
    && active.sessionId === event.sessionId,
  );
}

function applySessionUpdate(
  current: ControlPlaneSessionDetail,
  updater: SetStateAction<ControlPlaneSessionDetail>,
): ControlPlaneSessionDetail {
  return typeof updater === 'function' ? updater(current) : updater;
}

type SessionActivityContext = {
  sessionId: string;
  refresh: RefreshControlPlaneSession;
  refreshPendingApproval: (sessionId: string) => void;
  invalidateWorkspaceDiff: () => void;
  updateSession: Dispatch<SetStateAction<ControlPlaneSessionDetail>>;
  setRunning: Dispatch<SetStateAction<boolean>>;
  setLiveStatus: Dispatch<SetStateAction<string | undefined>>;
};

type ControlPlaneSessionActivity = Extract<ControlPlaneSessionEventEnvelope, { type: 'session.event' }>['activities'][number];

function applySessionActivity(activity: ControlPlaneSessionActivity, context: SessionActivityContext) {
  ClientSharedSessionActivityService.applyActivity(activity, {
    onAssistantStream: (streamActivity, liveStatus) => {
      context.updateSession((current) => (
        ClientSharedSessionMessageService.upsertLiveAssistantMessage(
          current,
          streamActivity.text,
          streamActivity.done,
        )
      ));
      context.setLiveStatus(liveStatus);
    },
    onRunStarted: (_runActivity, liveStatus) => {
      context.setRunning(true);
      context.setLiveStatus(liveStatus);
    },
    onRunFinished: () => {
      context.setRunning(false);
      context.setLiveStatus(undefined);
      void context.refresh(context.sessionId, { silent: true });
    },
    onLiveStatus: (_statusActivity, liveStatus) => {
      context.setLiveStatus(liveStatus);
    },
    onPendingApprovalChanged: () => {
      context.refreshPendingApproval(context.sessionId);
    },
    onWorkspaceChanged: () => {
      context.invalidateWorkspaceDiff();
    },
  });
}
