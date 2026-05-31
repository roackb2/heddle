import { useEffect, useMemo, useState } from 'react';
import type { ControlPlaneSessionDetail, ControlPlaneSessionRuntimeContext } from '@web/api/client';
import {
  type ClientSharedAgentActivityStatus,
  type ClientSharedSessionLatestUpdate,
  type ClientSharedSessionPlan,
} from '@/client-shared/services/session-activities';
import { useControlPlaneSessionEvents } from './useControlPlaneSessionEvents';
import { useControlPlaneSessionLoader } from './useControlPlaneSessionLoader';
import { useControlPlanePendingApproval } from './useControlPlanePendingApproval';
import { useControlPlaneSessionPromptSubmit } from './useControlPlaneSessionPromptSubmit';
import { useControlPlaneSessionRunControl } from './useControlPlaneSessionRunControl';
import { useControlPlaneSessionRuntimeContext } from './useControlPlaneSessionRuntimeContext';
import { useControlPlaneSessionSettings } from './useControlPlaneSessionSettings';

export type { ControlPlaneApprovalDecision, ControlPlanePendingApproval, ControlPlaneSessionDetail } from '@web/api/client';
export type { ControlPlaneReasoningEffortSelection } from './useControlPlaneSessionSettings';

type ControlPlaneSessionDetailState = {
  session: ControlPlaneSessionDetail;
  loading: boolean;
  submitting: boolean;
  running: boolean;
  cancelling: boolean;
  error?: string;
  liveStatus?: string;
  currentActivity?: ClientSharedAgentActivityStatus;
  latestUpdate?: ClientSharedSessionLatestUpdate;
  activePlan?: ClientSharedSessionPlan;
  runtimeContext?: ControlPlaneSessionRuntimeContext;
  cancelError?: string;
  pendingApproval: ReturnType<typeof useControlPlanePendingApproval>['pendingApproval'];
  approvalResolving: boolean;
  approvalError?: string;
  modelOptions: ReturnType<typeof useControlPlaneSessionSettings>['modelOptions'];
  settingsUpdating: boolean;
  settingsError?: string;
  submitPrompt: (prompt: string) => Promise<void>;
  cancelRun: () => Promise<void>;
  updateDriftEnabled: ReturnType<typeof useControlPlaneSessionSettings>['updateDriftEnabled'];
  updateModel: ReturnType<typeof useControlPlaneSessionSettings>['updateModel'];
  updateReasoningEffort: ReturnType<typeof useControlPlaneSessionSettings>['updateReasoningEffort'];
  resolvePendingApproval: ReturnType<typeof useControlPlanePendingApproval>['resolvePendingApproval'];
};

type UseControlPlaneSessionDetailArgs = {
  workspaceId?: string;
  sessionId?: string;
};

// Composes the web-v2 session detail workflow from focused hooks: persisted
// detail loading, live event subscription, and prompt submission.
export function useControlPlaneSessionDetail({
  workspaceId,
  sessionId,
}: UseControlPlaneSessionDetailArgs): ControlPlaneSessionDetailState {
  const [liveStatus, setLiveStatus] = useState<string | undefined>();
  const [currentActivity, setCurrentActivity] = useState<ClientSharedAgentActivityStatus | undefined>();
  const [latestUpdate, setLatestUpdate] = useState<ClientSharedSessionLatestUpdate | undefined>();
  const [activePlan, setActivePlan] = useState<ClientSharedSessionPlan | undefined>();
  const loader = useControlPlaneSessionLoader({ workspaceId, sessionId });
  const runControl = useControlPlaneSessionRunControl({
    workspaceId,
    sessionId,
    setLiveStatus,
    setError: loader.setError,
  });
  const runtimeContext = useControlPlaneSessionRuntimeContext({
    workspaceId,
    sessionId,
    running: runControl.running,
  });
  const approval = useControlPlanePendingApproval({ workspaceId, sessionId }, {
    pollingEnabled: runControl.running,
  });
  const events = useControlPlaneSessionEvents({
    workspaceId,
    sessionId,
    refresh: loader.refresh,
    refreshPendingApproval: approval.refreshPendingApproval,
    setSession: loader.setSession,
    setRunning: runControl.setRunning,
    setLiveStatus,
    setActivePlan,
    setCurrentActivity,
    setLatestUpdate,
  });
  const promptSubmit = useControlPlaneSessionPromptSubmit({
    workspaceId,
    sessionId,
    streamConnected: events.streamConnected,
    setRunning: runControl.setRunning,
    setError: loader.setError,
    setLiveStatus,
    setCurrentActivity,
  });
  const settings = useControlPlaneSessionSettings({
    workspaceId,
    sessionId,
    setSession: loader.setSession,
    setError: loader.setError,
  });

  useEffect(() => {
    if (!runControl.running && !promptSubmit.submitting) {
      setCurrentActivity(undefined);
    }
  }, [promptSubmit.submitting, runControl.running]);

  return useMemo(() => ({
    session: loader.session,
    loading: loader.loading,
    submitting: promptSubmit.submitting,
    running: runControl.running,
    cancelling: runControl.cancelling,
    error: loader.error,
    liveStatus,
    currentActivity,
    latestUpdate,
    activePlan,
    runtimeContext: runtimeContext.runtimeContext,
    cancelError: runControl.cancelError,
    pendingApproval: approval.pendingApproval,
    approvalResolving: approval.approvalResolving,
    approvalError: approval.approvalError,
    modelOptions: settings.modelOptions,
    settingsUpdating: settings.settingsUpdating,
    settingsError: settings.settingsError,
    submitPrompt: promptSubmit.submitPrompt,
    cancelRun: runControl.cancelRun,
    updateDriftEnabled: settings.updateDriftEnabled,
    updateModel: settings.updateModel,
    updateReasoningEffort: settings.updateReasoningEffort,
    resolvePendingApproval: approval.resolvePendingApproval,
  }), [
    approval.approvalError,
    approval.approvalResolving,
    approval.pendingApproval,
    approval.resolvePendingApproval,
    activePlan,
    currentActivity,
    latestUpdate,
    liveStatus,
    loader.error,
    loader.loading,
    loader.session,
    promptSubmit.submitting,
    promptSubmit.submitPrompt,
    runControl.cancelError,
    runControl.cancelRun,
    runControl.cancelling,
    runControl.running,
    runtimeContext.runtimeContext,
    settings.modelOptions,
    settings.settingsError,
    settings.settingsUpdating,
    settings.updateDriftEnabled,
    settings.updateModel,
    settings.updateReasoningEffort,
  ]);
}
