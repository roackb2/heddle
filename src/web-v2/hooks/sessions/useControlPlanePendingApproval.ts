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

type SessionAddress = {
  workspaceId?: string;
  sessionId?: string;
};

type UseControlPlanePendingApprovalOptions = {
  pollingEnabled?: boolean;
};

export function useControlPlanePendingApproval(
  { workspaceId, sessionId }: SessionAddress,
  options: UseControlPlanePendingApprovalOptions = {},
): ControlPlanePendingApprovalState {
  const utils = trpcReact.useUtils();
  const [approvalError, setApprovalError] = useState<string | undefined>();
  const pendingApprovalQuery = trpcReact.controlPlane.sessionPendingApproval.useQuery(
    sessionId && workspaceId ? { id: sessionId, workspaceId } : skipToken,
    {
      enabled: Boolean(sessionId && workspaceId),
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
    if (!workspaceId) {
      return;
    }

    void utils.controlPlane.sessionPendingApproval.invalidate({ id: targetSessionId, workspaceId });
  }, [utils, workspaceId]);

  const resolvePendingApproval = useCallback(async (decision: ControlPlaneApprovalDecision) => {
    if (!sessionId || !workspaceId) {
      return;
    }

    setApprovalError(undefined);
    try {
      const result = await resolveApprovalMutation.mutateAsync({
        workspaceId,
        sessionId,
        decision,
      });
      if (!result.resolved) {
        throw new Error('No pending approval found for this session.');
      }
      await utils.controlPlane.sessionPendingApproval.invalidate({ id: sessionId, workspaceId });
    } catch (error) {
      setApprovalError(error instanceof Error ? error.message : String(error));
    }
  }, [resolveApprovalMutation, sessionId, utils, workspaceId]);

  return {
    pendingApproval: pendingApprovalQuery.data ?? null,
    approvalResolving: resolveApprovalMutation.isPending,
    approvalError,
    refreshPendingApproval,
    resolvePendingApproval,
  };
}
