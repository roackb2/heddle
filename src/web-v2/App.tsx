import { useEffect, useMemo } from 'react';
import { trpcReact } from '@web/api/client';
import { useControlPlaneErrorToasts } from '@web/hooks/useControlPlaneErrorToasts';
import { useControlPlaneSessionDetail } from '@web/hooks/useControlPlaneSessionDetail';
import { useWorkbenchNavigation } from '@web/hooks/useWorkbenchNavigation';
import { AppFrame } from '@web/layout/AppFrame';
import { AppRoutes } from '@web/layout/AppRoutes';
import { APP_ROUTES, SETTINGS_ROUTES } from '@web/layout/routes';

export function App() {
  const navigation = useWorkbenchNavigation();
  const utils = trpcReact.useUtils();
  const stateQuery = trpcReact.controlPlane.state.useQuery();
  const createSessionMutation = trpcReact.controlPlane.sessionCreate.useMutation();
  const sidebarSessions = useMemo(
    () => stateQuery.data?.sessions ?? [],
    [stateQuery.data?.sessions],
  );
  const sidebarTasks = useMemo(
    () => stateQuery.data?.heartbeat.tasks ?? [],
    [stateQuery.data?.heartbeat.tasks],
  );
  const selectedSessionId = navigation.selectedSessionId;
  const selectedSession = useControlPlaneSessionDetail(selectedSessionId);
  useControlPlaneErrorToasts({
    stateError: stateQuery.error,
    sessionError: selectedSession.error,
  });

  useEffect(() => {
    if (selectedSessionId || navigation.settingsOpen || navigation.activeSurfaceId !== 'sessions' || sidebarSessions.length === 0) {
      return;
    }

    navigation.selectSession(sidebarSessions[0]!.id, { replace: true });
  }, [navigation, selectedSessionId, sidebarSessions]);

  async function createSession() {
    const session = await createSessionMutation.mutateAsync();
    navigation.selectSession(session.id);
    await utils.controlPlane.state.invalidate();
  }

  return (
    <AppFrame
      activeSurfaceId={navigation.activeSurfaceId}
      activeSettingsSectionId={navigation.activeSettingsSectionId}
      appNavigationItems={APP_ROUTES}
      settingsNavigationItems={SETTINGS_ROUTES}
      settingsOpen={navigation.settingsOpen}
      selectedSessionId={selectedSessionId}
      sessions={sidebarSessions}
      tasks={sidebarTasks}
      onOpenSettings={navigation.openSettings}
      onCloseSettings={navigation.closeSettings}
      onCreateSession={createSession}
      onSelectSession={navigation.selectSession}
    >
      <AppRoutes
        activeSurfaceId={navigation.activeSurfaceId}
        activeSettingsSectionId={navigation.activeSettingsSectionId}
        selectedSession={selectedSession.session}
        selectedSessionLoading={selectedSession.loading}
        selectedSessionSubmitting={selectedSession.submitting}
        selectedSessionLiveStatus={selectedSession.liveStatus}
        selectedSessionPendingApproval={selectedSession.pendingApproval}
        selectedSessionApprovalResolving={selectedSession.approvalResolving}
        selectedSessionApprovalError={selectedSession.approvalError}
        selectedSessionModelOptions={selectedSession.modelOptions}
        selectedSessionSettingsUpdating={selectedSession.settingsUpdating}
        selectedSessionSettingsError={selectedSession.settingsError}
        onSubmitSessionPrompt={selectedSession.submitPrompt}
        onUpdateSessionModel={selectedSession.updateModel}
        onUpdateSessionReasoningEffort={selectedSession.updateReasoningEffort}
        onResolveSessionApproval={selectedSession.resolvePendingApproval}
      />
    </AppFrame>
  );
}
