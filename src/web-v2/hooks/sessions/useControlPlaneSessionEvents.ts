import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { skipToken } from '@tanstack/react-query';
import {
  trpcReact,
  type ControlPlaneSessionDetail,
  type ControlPlaneSessionEventEnvelope,
  type ControlPlaneSessionRunEventEnvelope,
  type ControlPlaneSessionRunReference,
} from '@web/api/client';
import {
  ConversationRunConsumerService,
  type ConversationRunReference,
  type ConversationRunSubscriptionInput,
} from '@/client-shared/services/conversation-run-stream';
import { ClientSharedSessionActivityService } from '@/client-shared/services/session-activities';
import { ClientSharedNotificationIntentService, type ClientSharedNotificationIntent } from '@/client-shared/services/notifications';
import type {
  ClientSharedAgentActivityStatus,
  ClientSharedSessionLatestUpdate,
  ClientSharedSessionPlan,
} from '@/client-shared/services/session-activities';
import { ClientSharedSessionMessageService } from '@/client-shared/services/session-messages';
import type { RefreshControlPlaneSession } from './useControlPlaneSessionLoader';

type SessionRunUpdate = Extract<ControlPlaneSessionEventEnvelope, { type: 'session.run.updated' }>;
type SessionRunTerminal = Exclude<ControlPlaneSessionRunEventEnvelope, { kind: 'activity' }>;
type ControlPlaneConversationRunReference = ConversationRunReference & {
  workspaceId: string;
  sessionId: string;
};

type UseControlPlaneSessionEventsArgs = {
  workspaceId?: string;
  sessionId?: string;
  activeRun?: ControlPlaneSessionRunReference;
  refresh: RefreshControlPlaneSession;
  refreshPendingApproval: (sessionId: string) => void;
  observeRunUpdate: (event: SessionRunUpdate) => void;
  finishRun: (event: SessionRunTerminal) => void;
  setSession: Dispatch<SetStateAction<ControlPlaneSessionDetail>>;
  setLiveStatus: Dispatch<SetStateAction<string | undefined>>;
  setActivePlan: Dispatch<SetStateAction<ClientSharedSessionPlan | undefined>>;
  setCurrentActivity: Dispatch<SetStateAction<ClientSharedAgentActivityStatus | undefined>>;
  setLatestUpdate: Dispatch<SetStateAction<ClientSharedSessionLatestUpdate | undefined>>;
  onNotificationIntent?: (intent: ClientSharedNotificationIntent | undefined) => void;
};

export type ControlPlaneSessionEventsState = {
  streamConnected: boolean;
};

// Owns web-v2's selected-session lifecycle and replayable run subscriptions.
// Cursor correctness/backoff are shared with cli-v2; this hook only binds those
// semantics to React Query/tRPC and browser-local presentation state.
export function useControlPlaneSessionEvents({
  workspaceId,
  sessionId,
  activeRun,
  refresh,
  refreshPendingApproval,
  observeRunUpdate,
  finishRun,
  setSession,
  setLiveStatus,
  setActivePlan,
  setCurrentActivity,
  setLatestUpdate,
  onNotificationIntent,
}: UseControlPlaneSessionEventsArgs): ControlPlaneSessionEventsState {
  const utils = trpcReact.useUtils();
  const [streamConnected, setStreamConnected] = useState(false);
  const [runSubscriptionInput, setRunSubscriptionInput] = useState<
    ConversationRunSubscriptionInput<ControlPlaneConversationRunReference>
  >();
  const activeAddressRef = useRef<SessionAddress>({ workspaceId, sessionId });
  const runStreamRef = useRef(
    new ConversationRunConsumerService<ControlPlaneConversationRunReference>(),
  );
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const invalidateWorkspaceDiff = useCallback(() => {
    void utils.controlPlane.workspaceChanges.invalidate(workspaceId ? { workspaceId } : undefined);
    void utils.controlPlane.workspaceFileDiff.invalidate();
  }, [utils, workspaceId]);

  const ensureRunSubscription = useCallback((run: ControlPlaneSessionRunReference) => {
    if (!workspaceId || !sessionId) {
      return;
    }

    const selected = runStreamRef.current.select({ workspaceId, sessionId, runId: run.runId });
    if (selected && reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = undefined;
    }
    const input = runStreamRef.current.subscriptionInput();
    if (input) {
      setRunSubscriptionInput(input);
    }
  }, [sessionId, workspaceId]);

  const scheduleReconnect = useCallback((error: Error) => {
    if (runStreamRef.current.isTerminal() || reconnectTimerRef.current) {
      return;
    }

    setStreamConnected(false);
    setRunSubscriptionInput(undefined);
    const retry = runStreamRef.current.nextRetry();
    if (!retry) {
      setLiveStatus(error.message);
      return;
    }

    setLiveStatus(`Reconnecting run stream (attempt ${retry.attempt})...`);
    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = undefined;
      setRunSubscriptionInput(retry.input);
    }, retry.delayMs);
  }, [setLiveStatus]);

  const applySessionEvent = useCallback((event: ControlPlaneSessionEventEnvelope) => {
    if (!isActiveSessionAddress(activeAddressRef.current, { workspaceId, sessionId: event.sessionId })) {
      return;
    }

    if (event.type === 'waiting') {
      setLiveStatus('Waiting for the session event stream...');
      return;
    }

    if (event.type === 'session.updated' || event.type === 'session.queue.updated') {
      void refresh(event.sessionId, { silent: true });
      return;
    }

    if (event.type === 'session.approval.updated') {
      refreshPendingApproval(event.sessionId);
      return;
    }

    if (event.type !== 'session.run.updated') {
      return;
    }

    observeRunUpdate(event);
    ensureRunSubscription(event.run);
  }, [ensureRunSubscription, observeRunUpdate, refresh, refreshPendingApproval, setLiveStatus, workspaceId]);

  const applyRunEvent = useCallback((event: ControlPlaneSessionRunEventEnvelope) => {
    const {
      workspaceId: activeWorkspaceId,
      sessionId: activeSessionId,
    } = activeAddressRef.current;
    if (!activeWorkspaceId || !activeSessionId) {
      return;
    }

    try {
      const accepted = runStreamRef.current.accept(event);
      if (!accepted.accepted) {
        return;
      }
      if (event.kind !== 'activity') {
        setStreamConnected(false);
        setRunSubscriptionInput(undefined);
        finishRun(event);
        return;
      }

      applySessionActivity(event.activity, {
        sessionId: activeSessionId,
        refresh,
        refreshPendingApproval,
        invalidateWorkspaceDiff,
        updateSession: (updater) => {
          setSession(updater);
          utils.controlPlane.session.setData(
            { id: activeSessionId, workspaceId: activeWorkspaceId },
            (current) => applySessionUpdate(current ?? null, updater),
          );
        },
        setLiveStatus,
        setActivePlan,
        setCurrentActivity,
        setLatestUpdate,
        notify: onNotificationIntent,
        workspaceId: activeWorkspaceId,
      });
    } catch (error) {
      scheduleReconnect(asError(error));
    }
  }, [finishRun, invalidateWorkspaceDiff, onNotificationIntent, refresh, refreshPendingApproval, scheduleReconnect, setActivePlan, setCurrentActivity, setLatestUpdate, setLiveStatus, setSession, utils.controlPlane.session]);

  trpcReact.controlPlane.sessionEvents.useSubscription(
    sessionId && workspaceId ? { sessionId, workspaceId } : skipToken,
    {
      onData: applySessionEvent,
      onError: (error) => setLiveStatus(error.message),
    },
  );

  trpcReact.controlPlane.sessionRunEvents.useSubscription(
    runSubscriptionInput ?? skipToken,
    {
      onStarted: () => setStreamConnected(true),
      onData: applyRunEvent,
      onError: (error) => scheduleReconnect(asError(error)),
      onComplete: () => {
        setStreamConnected(false);
        if (!runStreamRef.current.isTerminal()) {
          scheduleReconnect(new Error('Conversation run stream ended before a terminal item.'));
        }
      },
    },
  );

  useEffect(() => {
    activeAddressRef.current = { workspaceId, sessionId };
    runStreamRef.current.clear();
    setRunSubscriptionInput(undefined);
    setStreamConnected(false);
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = undefined;
    }
    if (!sessionId || !workspaceId) {
      setLiveStatus(undefined);
      setActivePlan(undefined);
      setCurrentActivity(undefined);
      setLatestUpdate(undefined);
      return;
    }

    setLiveStatus(undefined);
    setActivePlan(undefined);
    setCurrentActivity(undefined);
    setLatestUpdate(undefined);
  }, [sessionId, setActivePlan, setCurrentActivity, setLatestUpdate, setLiveStatus, workspaceId]);

  useEffect(() => {
    if (activeRun) {
      ensureRunSubscription(activeRun);
    }
  }, [activeRun, ensureRunSubscription]);

  useEffect(() => () => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
    }
  }, []);

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
  workspaceId?: string;
  sessionId: string;
  refresh: RefreshControlPlaneSession;
  refreshPendingApproval: (sessionId: string) => void;
  invalidateWorkspaceDiff: () => void;
  updateSession: Dispatch<SetStateAction<ControlPlaneSessionDetail>>;
  setLiveStatus: Dispatch<SetStateAction<string | undefined>>;
  setActivePlan: Dispatch<SetStateAction<ClientSharedSessionPlan | undefined>>;
  setCurrentActivity: Dispatch<SetStateAction<ClientSharedAgentActivityStatus | undefined>>;
  setLatestUpdate: Dispatch<SetStateAction<ClientSharedSessionLatestUpdate | undefined>>;
  notify?: (intent: ClientSharedNotificationIntent | undefined) => void;
};

type ControlPlaneSessionActivity = Extract<ControlPlaneSessionRunEventEnvelope, { kind: 'activity' }>['activity'];

function applySessionActivity(activity: ControlPlaneSessionActivity, context: SessionActivityContext) {
  context.notify?.(ClientSharedNotificationIntentService.projectSessionActivity({
    workspaceId: context.workspaceId,
    sessionId: context.sessionId,
    activity,
  }));

  const latestUpdate = ClientSharedSessionActivityService.resolveLatestUpdate(activity);
  if (latestUpdate) {
    context.setLatestUpdate(latestUpdate);
  }

  ClientSharedSessionActivityService.applyActivity(activity, {
    onAssistantStream: (streamActivity, liveStatus) => {
      context.updateSession((current) => (
        ClientSharedSessionMessageService.upsertLiveAssistantMessage(
          current,
          streamActivity.text,
          streamActivity.done,
        )
      ));
      if (liveStatus !== undefined) {
        context.setLiveStatus(liveStatus);
      }
    },
    onRunStarted: (_runActivity, liveStatus) => {
      context.setLiveStatus(liveStatus);
    },
    onRunFinished: (_runActivity, liveStatus) => {
      if (liveStatus !== undefined) {
        context.setLiveStatus(liveStatus);
      }
    },
    onPlanUpdated: (plan) => context.setActivePlan(plan),
    onPlanCleared: () => context.setActivePlan(undefined),
    onCurrentActivityChanged: (currentActivity) => context.setCurrentActivity(currentActivity),
    onLiveStatus: (_statusActivity, liveStatus) => {
      if (liveStatus !== undefined) {
        context.setLiveStatus(liveStatus);
      }
    },
    onPendingApprovalChanged: () => context.refreshPendingApproval(context.sessionId),
    onWorkspaceChanged: context.invalidateWorkspaceDiff,
  });
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
