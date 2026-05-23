import { useMemo, useState } from 'react';
import type { ControlPlaneSessionDetail } from '@web/api/client';
import { useControlPlaneSessionEvents } from './useControlPlaneSessionEvents';
import { useControlPlaneSessionLoader } from './useControlPlaneSessionLoader';
import { useControlPlanePendingApproval } from './useControlPlanePendingApproval';
import { useControlPlaneSessionPromptSubmit } from './useControlPlaneSessionPromptSubmit';
import { useControlPlaneSessionSettings } from './useControlPlaneSessionSettings';

export type { ControlPlaneApprovalDecision, ControlPlanePendingApproval, ControlPlaneSessionDetail } from '@web/api/client';
export type { ControlPlaneReasoningEffortSelection } from './useControlPlaneSessionSettings';

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
  modelOptions: ReturnType<typeof useControlPlaneSessionSettings>['modelOptions'];
  settingsUpdating: boolean;
  settingsError?: string;
  submitPrompt: (prompt: string) => Promise<void>;
  updateModel: ReturnType<typeof useControlPlaneSessionSettings>['updateModel'];
  updateReasoningEffort: ReturnType<typeof useControlPlaneSessionSettings>['updateReasoningEffort'];
  resolvePendingApproval: ReturnType<typeof useControlPlanePendingApproval>['resolvePendingApproval'];
};

// Composes the web-v2 session detail workflow from focused hooks: persisted
// detail loading, live event subscription, and prompt submission.
export function useControlPlaneSessionDetail(sessionId: string | undefined): ControlPlaneSessionDetailState {
  const [running, setRunning] = useState(false);
  const [liveStatus, setLiveStatus] = useState<string | undefined>();
  const loader = useControlPlaneSessionLoader(sessionId);
  const approval = useControlPlanePendingApproval(sessionId, {
    pollingEnabled: running,
  });
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
  const settings = useControlPlaneSessionSettings({
    sessionId,
    setSession: loader.setSession,
    setError: loader.setError,
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
    modelOptions: settings.modelOptions,
    settingsUpdating: settings.settingsUpdating,
    settingsError: settings.settingsError,
    submitPrompt: promptSubmit.submitPrompt,
    updateModel: settings.updateModel,
    updateReasoningEffort: settings.updateReasoningEffort,
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
    settings.modelOptions,
    settings.settingsError,
    settings.settingsUpdating,
    settings.updateModel,
    settings.updateReasoningEffort,
  ]);
}
