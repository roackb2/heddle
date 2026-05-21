import { useEffect, useState } from 'react';
import { useControlPlaneSidebarData } from '@web/hooks/useControlPlaneSidebarData';
import { useControlPlaneSessionDetail } from '@web/hooks/useControlPlaneSessionDetail';
import { useWorkbenchNavigation } from '@web/hooks/useWorkbenchNavigation';
import { AppFrame } from '@web/layout/AppFrame';
import { AppRoutes } from '@web/layout/AppRoutes';
import { APP_ROUTES, SETTINGS_ROUTES } from '@web/layout/routes';

export function App() {
  const navigation = useWorkbenchNavigation();
  const sidebarData = useControlPlaneSidebarData();
  const [selectedSessionId, setSelectedSessionId] = useState<string | undefined>();
  const selectedSession = useControlPlaneSessionDetail(selectedSessionId);

  useEffect(() => {
    if (selectedSessionId || sidebarData.sessions.length === 0) {
      return;
    }

    setSelectedSessionId(sidebarData.sessions[0]?.id);
  }, [selectedSessionId, sidebarData.sessions]);

  return (
    <AppFrame
      activeSurfaceId={navigation.activeSurfaceId}
      activeSettingsSectionId={navigation.activeSettingsSectionId}
      appNavigationItems={APP_ROUTES}
      settingsNavigationItems={SETTINGS_ROUTES}
      settingsOpen={navigation.settingsOpen}
      selectedSessionId={selectedSessionId}
      sessions={sidebarData.sessions}
      tasks={sidebarData.tasks}
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
        selectedSessionRunning={selectedSession.running}
        selectedSessionLiveStreamConnected={selectedSession.liveStreamConnected}
        selectedSessionLiveStatus={selectedSession.liveStatus}
        selectedSessionError={selectedSession.error}
        onSubmitSessionPrompt={selectedSession.submitPrompt}
      />
    </AppFrame>
  );
}
