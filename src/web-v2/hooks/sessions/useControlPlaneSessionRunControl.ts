import { skipToken } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { trpcReact } from '@web/api/client';

export type ControlPlaneSessionRunControlState = {
  running: boolean;
  cancelling: boolean;
  cancelError?: string;
  setRunning: Dispatch<SetStateAction<boolean>>;
  cancelRun: () => Promise<void>;
};

type UseControlPlaneSessionRunControlArgs = {
  workspaceId?: string;
  sessionId?: string;
  setLiveStatus: (status: string | undefined) => void;
  setError: (error: string | undefined) => void;
};

// Owns web-v2 run-control state that has to reconcile optimistic local turn
// state, server-held in-flight runs, and user-requested cancellation.
export function useControlPlaneSessionRunControl({
  workspaceId,
  sessionId,
  setLiveStatus,
  setError,
}: UseControlPlaneSessionRunControlArgs): ControlPlaneSessionRunControlState {
  const utils = trpcReact.useUtils();
  const [running, setRunningState] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | undefined>();
  const serverConfirmedRunningRef = useRef(false);
  const sessionRunningQuery = trpcReact.controlPlane.sessionRunning.useQuery(
    sessionId && workspaceId ? { id: sessionId, workspaceId } : skipToken,
    {
      enabled: Boolean(sessionId && workspaceId),
      refetchInterval: running || cancelling ? 1000 : false,
      refetchOnWindowFocus: false,
    },
  );
  const cancelMutation = trpcReact.controlPlane.sessionCancel.useMutation();

  useEffect(() => {
    setRunningState(false);
    setCancelling(false);
    setCancelError(undefined);
    serverConfirmedRunningRef.current = false;
  }, [sessionId, workspaceId]);

  useEffect(() => {
    const serverRunning = sessionRunningQuery.data?.running;
    if (serverRunning) {
      serverConfirmedRunningRef.current = true;
      setRunningState(true);
      return;
    }

    if (serverRunning === false && (running || cancelling || serverConfirmedRunningRef.current)) {
      serverConfirmedRunningRef.current = false;
      setRunningState(false);
      setCancelling(false);
      setLiveStatus(undefined);
    }
  }, [cancelling, running, sessionRunningQuery.data?.running, setLiveStatus]);

  const setRunning = useCallback<Dispatch<SetStateAction<boolean>>>((nextRunning) => {
    setRunningState((current) => (
      typeof nextRunning === 'function' ? nextRunning(current) : nextRunning
    ));
    if (nextRunning === false) {
      serverConfirmedRunningRef.current = false;
    }
    setCancelling(false);
    setCancelError(undefined);
  }, []);

  const cancelRun = useCallback(async () => {
    if (!sessionId || !workspaceId || cancelMutation.isPending) {
      return;
    }

    setCancelling(true);
    setCancelError(undefined);
    setLiveStatus('Stop requested. Waiting for the current step to settle...');

    try {
      const result = await cancelMutation.mutateAsync({ id: sessionId, workspaceId });
      await utils.controlPlane.sessionPendingApproval.invalidate({ id: sessionId, workspaceId });
      await utils.controlPlane.sessionRunning.invalidate({ id: sessionId, workspaceId });
      if (!result.cancelled) {
        setRunningState(false);
        setCancelling(false);
        setLiveStatus(undefined);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setCancelError(message);
      setError(message);
      setCancelling(false);
      setLiveStatus(undefined);
    }
  }, [cancelMutation, sessionId, setError, setLiveStatus, utils, workspaceId]);

  return {
    running,
    cancelling: cancelling || cancelMutation.isPending,
    cancelError,
    setRunning,
    cancelRun,
  };
}
