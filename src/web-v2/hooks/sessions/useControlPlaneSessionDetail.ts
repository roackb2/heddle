import { useEffect, useMemo, useState } from 'react';
import type {
  ControlPlaneSessionDetail,
  ControlPlaneSessionDirectShellPreflight,
  ControlPlaneSessionRuntimeContext,
} from '@web/api/client';
import {
  type ClientSharedAgentActivityStatus,
  type ClientSharedSessionLatestUpdate,
  type ClientSharedSessionPlan,
} from '@/client-shared/services/session-activities';
import type { ClientSharedNotificationIntent } from '@/client-shared/services/notifications';
import { useControlPlaneSessionEvents } from './useControlPlaneSessionEvents';
import { useControlPlaneSessionLoader } from './useControlPlaneSessionLoader';
import { useControlPlanePendingApproval } from './useControlPlanePendingApproval';
import { useControlPlaneSessionPromptSubmit } from './useControlPlaneSessionPromptSubmit';
import { useControlPlaneSessionRunControl } from './useControlPlaneSessionRunControl';
import { useControlPlaneSessionRuntimeContext } from './useControlPlaneSessionRuntimeContext';
import { useControlPlaneSessionSettings } from './useControlPlaneSessionSettings';
import { useControlPlaneQueuedPrompts } from './useControlPlaneQueuedPrompts';

export type {
  ControlPlaneApprovalDecision,
  ControlPlanePendingApproval,
  ControlPlaneSessionDetail,
  ControlPlaneSessionDirectShellPreflight,
} from '@web/api/client';
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
  queueUpdating: boolean;
  directShellConfirmation?: ControlPlaneSessionDirectShellPreflight;
  submitPrompt: ReturnType<typeof useControlPlaneSessionPromptSubmit>['submitPrompt'];
  confirmDirectShell: () => Promise<void>;
  cancelDirectShellConfirmation: () => void;
  updateQueuedPrompt: ReturnType<typeof useControlPlaneQueuedPrompts>['updateQueuedPrompt'];
  deleteQueuedPrompt: ReturnType<typeof useControlPlaneQueuedPrompts>['deleteQueuedPrompt'];
  cancelRun: () => Promise<void>;
  updateDriftEnabled: ReturnType<typeof useControlPlaneSessionSettings>['updateDriftEnabled'];
  updatePermissionMode: ReturnType<typeof useControlPlaneSessionSettings>['updatePermissionMode'];
  updateModel: ReturnType<typeof useControlPlaneSessionSettings>['updateModel'];
  updateReasoningEffort: ReturnType<typeof useControlPlaneSessionSettings>['updateReasoningEffort'];
  resolvePendingApproval: ReturnType<typeof useControlPlanePendingApproval>['resolvePendingApproval'];
};

type UseControlPlaneSessionDetailArgs = {
  workspaceId?: string;
  sessionId?: string;
  onNotificationIntent?: (intent: ClientSharedNotificationIntent | undefined) => void;
};

// Composes the web-v2 session detail workflow from focused hooks: persisted
// detail loading, live event subscription, and prompt submission.
export function useControlPlaneSessionDetail({
  workspaceId,
  sessionId,
  onNotificationIntent,
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
  const approval = useControlPlanePendingApproval({
    workspaceId,
    sessionId,
    runId: runControl.activeRun?.runId,
  }, {
    pollingEnabled: runControl.running,
  });
  const events = useControlPlaneSessionEvents({
    workspaceId,
    sessionId,
    activeRun: runControl.activeRun,
    refresh: loader.refresh,
    refreshPendingApproval: approval.refreshPendingApproval,
    observeRunUpdate: runControl.observeRunUpdate,
    finishRun: runControl.finishRun,
    setSession: loader.setSession,
    setLiveStatus,
    setActivePlan,
    setCurrentActivity,
    setLatestUpdate,
    onNotificationIntent,
  });
  const promptSubmit = useControlPlaneSessionPromptSubmit({
    workspaceId,
    sessionId,
    running: runControl.running,
    streamConnected: events.streamConnected,
    setRunning: runControl.setRunning,
    setError: loader.setError,
    setLiveStatus,
    setCurrentActivity,
    onRunAccepted: runControl.trackAcceptedRun,
  });
  const settings = useControlPlaneSessionSettings({
    workspaceId,
    sessionId,
    setSession: loader.setSession,
    setError: loader.setError,
  });
  const queuedPrompts = useControlPlaneQueuedPrompts({
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
    queueUpdating: queuedPrompts.queueUpdating,
    directShellConfirmation: promptSubmit.directShellConfirmation,
    submitPrompt: promptSubmit.submitPrompt,
    confirmDirectShell: promptSubmit.confirmDirectShell,
    cancelDirectShellConfirmation: promptSubmit.cancelDirectShellConfirmation,
    updateQueuedPrompt: queuedPrompts.updateQueuedPrompt,
    deleteQueuedPrompt: queuedPrompts.deleteQueuedPrompt,
    cancelRun: runControl.cancelRun,
    updateDriftEnabled: settings.updateDriftEnabled,
    updatePermissionMode: settings.updatePermissionMode,
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
    promptSubmit.directShellConfirmation,
    promptSubmit.confirmDirectShell,
    promptSubmit.cancelDirectShellConfirmation,
    queuedPrompts.deleteQueuedPrompt,
    queuedPrompts.queueUpdating,
    queuedPrompts.updateQueuedPrompt,
    runControl.cancelError,
    runControl.cancelRun,
    runControl.cancelling,
    runControl.running,
    runtimeContext.runtimeContext,
    settings.modelOptions,
    settings.settingsError,
    settings.settingsUpdating,
    settings.updateDriftEnabled,
    settings.updatePermissionMode,
    settings.updateModel,
    settings.updateReasoningEffort,
  ]);
}
