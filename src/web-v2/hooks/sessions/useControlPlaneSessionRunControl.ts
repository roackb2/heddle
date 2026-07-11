import { skipToken } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import {
  trpcReact,
  type ControlPlaneSessionEventEnvelope,
  type ControlPlaneSessionRunEventEnvelope,
  type ControlPlaneSessionRunReference,
} from '@web/api/client';

type SessionRunUpdate = Extract<ControlPlaneSessionEventEnvelope, { type: 'session.run.updated' }>;
type SessionRunTerminal = Exclude<ControlPlaneSessionRunEventEnvelope, { kind: 'activity' }>;

export type ControlPlaneSessionRunControlState = {
  running: boolean;
  activeRun?: ControlPlaneSessionRunReference;
  cancelling: boolean;
  cancelError?: string;
  setRunning: Dispatch<SetStateAction<boolean>>;
  trackAcceptedRun: (run: ControlPlaneSessionRunReference) => void;
  observeRunUpdate: (event: SessionRunUpdate) => void;
  finishRun: (event: SessionRunTerminal) => void;
  cancelRun: () => Promise<void>;
};

type UseControlPlaneSessionRunControlArgs = {
  workspaceId?: string;
  sessionId?: string;
  setLiveStatus: (status: string | undefined) => void;
  setError: (error: string | undefined) => void;
};

// Owns web-v2's mirror of the accepted run identity and terminal state. The
// replayable run stream is primary; sessionRunState remains refresh/recovery
// fallback and prevents a browser refresh from starting a duplicate turn.
export function useControlPlaneSessionRunControl({
  workspaceId,
  sessionId,
  setLiveStatus,
  setError,
}: UseControlPlaneSessionRunControlArgs): ControlPlaneSessionRunControlState {
  const utils = trpcReact.useUtils();
  const [running, setRunningState] = useState(false);
  const [activeRun, setActiveRun] = useState<ControlPlaneSessionRunReference>();
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | undefined>();
  const serverConfirmedRunningRef = useRef(false);
  const terminalRunIdRef = useRef<string | undefined>(undefined);
  const runStateBaselineUpdatedAtRef = useRef(0);
  const runStateDataUpdatedAtRef = useRef(0);
  const sessionRunStateQuery = trpcReact.controlPlane.sessionRunState.useQuery(
    sessionId && workspaceId ? { id: sessionId, workspaceId } : skipToken,
    {
      enabled: Boolean(sessionId && workspaceId),
      refetchInterval: running || cancelling ? 1000 : false,
      refetchOnWindowFocus: false,
    },
  );
  const cancelMutation = trpcReact.controlPlane.sessionCancel.useMutation();

  useEffect(() => {
    runStateDataUpdatedAtRef.current = sessionRunStateQuery.dataUpdatedAt;
  }, [sessionRunStateQuery.dataUpdatedAt]);

  useEffect(() => {
    setRunningState(false);
    setActiveRun(undefined);
    setCancelling(false);
    setCancelError(undefined);
    serverConfirmedRunningRef.current = false;
    terminalRunIdRef.current = undefined;
    runStateBaselineUpdatedAtRef.current = 0;
  }, [sessionId, workspaceId]);

  useEffect(() => {
    const serverRun = sessionRunStateQuery.data?.activeRun ?? undefined;
    const serverRunning = sessionRunStateQuery.data?.running;
    const hasFreshRunState = sessionRunStateQuery.dataUpdatedAt > runStateBaselineUpdatedAtRef.current;
    if (serverRun && hasFreshRunState && serverRun.runId !== terminalRunIdRef.current) {
      serverConfirmedRunningRef.current = true;
      setActiveRun(serverRun);
      setRunningState(true);
      return;
    }

    if (
      serverRunning === false
      && hasFreshRunState
      && (cancelling || serverConfirmedRunningRef.current || running)
    ) {
      serverConfirmedRunningRef.current = false;
      setActiveRun(undefined);
      setRunningState(false);
      setCancelling(false);
      if (sessionId && workspaceId) {
        void Promise.all([
          utils.controlPlane.session.invalidate({ id: sessionId, workspaceId }),
          utils.controlPlane.sessions.invalidate({ workspaceId }),
          utils.controlPlane.sessionPendingApproval.invalidate({ id: sessionId, workspaceId }),
        ]).catch(() => undefined);
      }
    }
  }, [
    cancelling,
    running,
    sessionId,
    sessionRunStateQuery.data?.activeRun,
    sessionRunStateQuery.data?.running,
    sessionRunStateQuery.dataUpdatedAt,
    utils,
    workspaceId,
  ]);

  const setRunning = useCallback<Dispatch<SetStateAction<boolean>>>((nextRunning) => {
    setRunningState((current) => {
      const resolved = typeof nextRunning === 'function' ? nextRunning(current) : nextRunning;
      if (resolved) {
        runStateBaselineUpdatedAtRef.current = runStateDataUpdatedAtRef.current;
      } else {
        serverConfirmedRunningRef.current = false;
        setActiveRun(undefined);
      }

      return resolved;
    });
    setCancelling(false);
    setCancelError(undefined);
  }, []);

  const trackAcceptedRun = useCallback((run: ControlPlaneSessionRunReference) => {
    if (terminalRunIdRef.current === run.runId) {
      return;
    }
    terminalRunIdRef.current = undefined;
    runStateBaselineUpdatedAtRef.current = runStateDataUpdatedAtRef.current;
    setActiveRun(run);
    setRunningState(true);
    setCancelling(false);
    setCancelError(undefined);
    serverConfirmedRunningRef.current = true;
  }, []);

  const observeRunUpdate = useCallback((event: SessionRunUpdate) => {
    if (event.status === 'started') {
      trackAcceptedRun(event.run);
    }
  }, [trackAcceptedRun]);

  const finishRun = useCallback((event: SessionRunTerminal) => {
    terminalRunIdRef.current = event.runId;
    runStateBaselineUpdatedAtRef.current = runStateDataUpdatedAtRef.current;
    setActiveRun((current) => current?.runId === event.runId ? undefined : current);
    setRunningState(false);
    setCancelling(false);
    serverConfirmedRunningRef.current = false;
    if (event.kind === 'error') {
      setError(event.error.message);
      setLiveStatus(event.error.message);
    } else if (event.kind === 'cancelled') {
      setLiveStatus('Run cancelled.');
    } else {
      setLiveStatus(undefined);
    }
    if (sessionId && workspaceId) {
      void Promise.all([
        utils.controlPlane.session.invalidate({ id: sessionId, workspaceId }),
        utils.controlPlane.sessions.invalidate({ workspaceId }),
        utils.controlPlane.sessionPendingApproval.invalidate({ id: sessionId, workspaceId }),
        utils.controlPlane.sessionRunState.invalidate({ id: sessionId, workspaceId }),
      ]).catch(() => undefined);
    }
  }, [sessionId, setError, setLiveStatus, utils, workspaceId]);

  const cancelRun = useCallback(async () => {
    if (!sessionId || !workspaceId || cancelMutation.isPending) {
      return;
    }

    runStateBaselineUpdatedAtRef.current = runStateDataUpdatedAtRef.current;
    setCancelling(true);
    setCancelError(undefined);
    setLiveStatus('Stop requested. Waiting for the current step to settle...');

    try {
      const result = await cancelMutation.mutateAsync({
        id: sessionId,
        workspaceId,
        runId: activeRun?.runId,
      });
      await Promise.all([
        utils.controlPlane.sessionPendingApproval.invalidate({ id: sessionId, workspaceId }),
        utils.controlPlane.sessionRunState.invalidate({ id: sessionId, workspaceId }),
      ]);
      const runState = await utils.controlPlane.sessionRunState.fetch({ id: sessionId, workspaceId });
      setActiveRun(runState.activeRun ?? undefined);
      setRunningState(runState.running);
      setCancelling(false);
      serverConfirmedRunningRef.current = Boolean(runState.activeRun);
      setLiveStatus(result.cancelled && runState.running
        ? 'Stop requested. Waiting for the current step to settle...'
        : undefined);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setCancelError(message);
      setError(message);
      setCancelling(false);
      setLiveStatus(undefined);
    }
  }, [activeRun?.runId, cancelMutation, sessionId, setError, setLiveStatus, utils, workspaceId]);

  return {
    running,
    activeRun,
    cancelling: cancelling || cancelMutation.isPending,
    cancelError,
    setRunning,
    trackAcceptedRun,
    observeRunUpdate,
    finishRun,
    cancelRun,
  };
}
