import { useEffect, useMemo, useState } from 'react';
import { trpcReact } from '@web/api/client';
import { useControlPlaneErrorToasts } from '@web/hooks/useControlPlaneErrorToasts';
import { useControlPlaneSessionDetail } from '@web/hooks/useControlPlaneSessionDetail';
import { useWorkbenchNavigation } from '@web/hooks/useWorkbenchNavigation';
import { AppFrame } from '@web/layout/AppFrame';
import { AppRoutes } from '@web/layout/AppRoutes';
import { APP_ROUTES, SETTINGS_ROUTES } from '@web/layout/routes';

export function App() {
  const navigation = useWorkbenchNavigation();
  const stateQuery = trpcReact.controlPlane.state.useQuery();
  const sidebarSessions = useMemo(
    () => stateQuery.data?.sessions ?? [],
    [stateQuery.data?.sessions],
  );
  const sidebarTasks = useMemo(
    () => stateQuery.data?.heartbeat.tasks ?? [],
    [stateQuery.data?.heartbeat.tasks],
  );
  const [selectedSessionId, setSelectedSessionId] = useState<string | undefined>();
  const selectedSession = useControlPlaneSessionDetail(selectedSessionId);
  useControlPlaneErrorToasts({
    stateError: stateQuery.error,
    sessionError: selectedSession.error,
  });

  useEffect(() => {
    if (selectedSessionId || sidebarSessions.length === 0) {
      return;
    }

    setSelectedSessionId(sidebarSessions[0]?.id);
  }, [selectedSessionId, sidebarSessions]);

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
      onSelectSession={setSelectedSessionId}
    >
      <AppRoutes
        activeSurfaceId={navigation.activeSurfaceId}
        activeSettingsSectionId={navigation.activeSettingsSectionId}
        selectedSession={selectedSession.session}
        selectedSessionLoading={selectedSession.loading}
        selectedSessionSubmitting={selectedSession.submitting}
        selectedSessionLiveStatus={selectedSession.liveStatus}
        onSubmitSessionPrompt={selectedSession.submitPrompt}
      />
    </AppFrame>
  );
}
