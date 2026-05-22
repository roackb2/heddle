import { useMemo, useState } from 'react';
import type { ControlPlaneSessionDetail } from '@web/api/client';
import { useControlPlaneSessionEvents } from './useControlPlaneSessionEvents';
import { useControlPlaneSessionLoader } from './useControlPlaneSessionLoader';
import { useControlPlanePendingApproval } from './useControlPlanePendingApproval';
import { useControlPlaneSessionPromptSubmit } from './useControlPlaneSessionPromptSubmit';

export type { ControlPlaneApprovalDecision, ControlPlanePendingApproval, ControlPlaneSessionDetail } from '@web/api/client';

type ControlPlaneSessionDetailState = {
  session: ControlPlaneSessionDetail;
  loading: boolean;
  submitting: boolean;
  running: boolean;
  error?: string;
  liveStatus?: string;
  pendingApproval: ReturnType<typeof useControlPlanePendingApproval>['pendingApproval'];
  approvalResolving: boolean;
  approvalError?: string;
  submitPrompt: (prompt: string) => Promise<void>;
  resolvePendingApproval: ReturnType<typeof useControlPlanePendingApproval>['resolvePendingApproval'];
};

// Composes the web-v2 session detail workflow from focused hooks: persisted
// detail loading, live event subscription, and prompt submission.
export function useControlPlaneSessionDetail(sessionId: string | undefined): ControlPlaneSessionDetailState {
  const [running, setRunning] = useState(false);
  const [liveStatus, setLiveStatus] = useState<string | undefined>();
  const loader = useControlPlaneSessionLoader(sessionId);
  const approval = useControlPlanePendingApproval(sessionId);
  const events = useControlPlaneSessionEvents({
    sessionId,
    refresh: loader.refresh,
    refreshPendingApproval: approval.refreshPendingApproval,
    setSession: loader.setSession,
    setRunning,
    setLiveStatus,
  });
  const promptSubmit = useControlPlaneSessionPromptSubmit({
    sessionId,
    streamConnected: events.streamConnected,
    setSession: loader.setSession,
    setRunning,
    setError: loader.setError,
    setLiveStatus,
  });

  return useMemo(() => ({
    session: loader.session,
    loading: loader.loading,
    submitting: promptSubmit.submitting,
    running,
    error: loader.error,
    liveStatus,
    pendingApproval: approval.pendingApproval,
    approvalResolving: approval.approvalResolving,
    approvalError: approval.approvalError,
    submitPrompt: promptSubmit.submitPrompt,
    resolvePendingApproval: approval.resolvePendingApproval,
  }), [
    approval.approvalError,
    approval.approvalResolving,
    approval.pendingApproval,
    approval.resolvePendingApproval,
    liveStatus,
    loader.error,
    loader.loading,
    loader.session,
    promptSubmit.submitting,
    promptSubmit.submitPrompt,
    running,
  ]);
}
