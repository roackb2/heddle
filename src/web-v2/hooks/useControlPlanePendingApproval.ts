import { skipToken } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import {
  trpcReact,
  type ControlPlaneApprovalDecision,
  type ControlPlanePendingApproval,
} from '@web/api/client';

export type ControlPlanePendingApprovalState = {
  pendingApproval: ControlPlanePendingApproval;
  approvalResolving: boolean;
  approvalError?: string;
  refreshPendingApproval: (sessionId: string) => void;
  resolvePendingApproval: (decision: ControlPlaneApprovalDecision) => Promise<void>;
};

type UseControlPlanePendingApprovalOptions = {
  pollingEnabled?: boolean;
};

export function useControlPlanePendingApproval(
  sessionId: string | undefined,
  options: UseControlPlanePendingApprovalOptions = {},
): ControlPlanePendingApprovalState {
  const utils = trpcReact.useUtils();
  const [approvalError, setApprovalError] = useState<string | undefined>();
  const pendingApprovalQuery = trpcReact.controlPlane.sessionPendingApproval.useQuery(
    sessionId ? { id: sessionId } : skipToken,
    {
      enabled: Boolean(sessionId),
      // The live stream is only a notification channel. Poll while a run is
      // active so a prompt submitted during subscription setup still discovers
      // server-held approval requests.
      refetchInterval: options.pollingEnabled ? 750 : false,
      refetchOnWindowFocus: false,
    },
  );
  const resolveApprovalMutation = trpcReact.controlPlane.sessionResolveApproval.useMutation();

  useEffect(() => {
    setApprovalError(undefined);
  }, [sessionId]);

  const refreshPendingApproval = useCallback((targetSessionId: string) => {
    void utils.controlPlane.sessionPendingApproval.invalidate({ id: targetSessionId });
  }, [utils]);

  const resolvePendingApproval = useCallback(async (decision: ControlPlaneApprovalDecision) => {
    if (!sessionId) {
      return;
    }

    setApprovalError(undefined);
    try {
      const result = await resolveApprovalMutation.mutateAsync({
        sessionId,
        decision,
      });
      if (!result.resolved) {
        throw new Error('No pending approval found for this session.');
      }
      await utils.controlPlane.sessionPendingApproval.invalidate({ id: sessionId });
    } catch (error) {
      setApprovalError(error instanceof Error ? error.message : String(error));
    }
  }, [resolveApprovalMutation, sessionId, utils]);

  return {
    pendingApproval: pendingApprovalQuery.data ?? null,
    approvalResolving: resolveApprovalMutation.isPending,
    approvalError,
    refreshPendingApproval,
    resolvePendingApproval,
  };
}
