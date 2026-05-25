import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { skipToken } from '@tanstack/react-query';
import {
  trpcReact,
  type ControlPlaneSessionDetail,
  type ControlPlaneSessionEventEnvelope,
} from '@web/api/client';
import { SessionMessageController } from '@web/controllers/session-messages';
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
type SessionActivityHandlerMap = {
  [ActivityType in ControlPlaneSessionActivity['type']]?: (
    activity: Extract<ControlPlaneSessionActivity, { type: ActivityType }>,
    context: SessionActivityContext,
  ) => void;
};

const sessionActivityHandlers: SessionActivityHandlerMap = {
  'assistant.stream': (activity, { updateSession, setLiveStatus }) => {
    updateSession((current) => (
      SessionMessageController.upsertLiveAssistantMessage(
        current,
        activity.text,
        activity.done,
      )
    ));
    setLiveStatus(activity.done ? undefined : 'Receiving assistant response...');
  },
  'loop.started': (_activity, { setRunning, setLiveStatus }) => {
    setRunning(true);
    setLiveStatus('Run started...');
  },
  'loop.finished': (_activity, { sessionId, refresh, invalidateWorkspaceDiff, setRunning, setLiveStatus }) => {
    setRunning(false);
    setLiveStatus(undefined);
    void refresh(sessionId, { silent: true });
    invalidateWorkspaceDiff();
  },
  'tool.calling': (activity, { setLiveStatus }) => {
    setLiveStatus(`Working... running ${activity.derived?.kind === 'tool-summary' ? activity.derived.summary : activity.tool}${formatStep(activity.step)}`);
  },
  'tool.completed': (activity, { invalidateWorkspaceDiff, setLiveStatus }) => {
    setLiveStatus(`${activity.tool} finished in ${Math.round(activity.durationMs)}ms`);
    invalidateWorkspaceDiff();
  },
  'tool.approval_requested': (activity, { sessionId, refreshPendingApproval, setLiveStatus }) => {
    refreshPendingApproval(sessionId);
    setLiveStatus(`Approval requested for ${activity.derived?.kind === 'tool-summary' ? activity.derived.summary : activity.call.tool}`);
  },
  'tool.approval_resolved': (_activity, { sessionId, refreshPendingApproval, setLiveStatus }) => {
    refreshPendingApproval(sessionId);
    setLiveStatus('Approval resolved. Resuming...');
  },
  'compaction.running': (activity, { setLiveStatus }) => {
    setLiveStatus(activity.archivePath ? `Compacting earlier history... ${activity.archivePath}` : 'Compacting earlier history...');
  },
  'compaction.failed': (activity, { setLiveStatus }) => {
    setLiveStatus(activity.error ? `Compaction failed: ${activity.error}` : 'Compaction failed.');
  },
  'compaction.finished': (activity, { setLiveStatus }) => {
    setLiveStatus(activity.summaryPath ? `Compaction finished. Summary: ${activity.summaryPath}` : 'Compaction finished.');
  },
};

function applySessionActivity(activity: ControlPlaneSessionActivity, context: SessionActivityContext) {
  const handler = sessionActivityHandlers[activity.type] as ((activity: ControlPlaneSessionActivity, context: SessionActivityContext) => void) | undefined;
  handler?.(activity, context);
}

function formatStep(step: number | undefined): string {
  return typeof step === 'number' ? ` (step ${step})` : '';
}
