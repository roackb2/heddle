import { useEffect, useMemo, useRef, useState } from 'react';
import { trpcReact } from '@web/api/client';
import { useControlPlaneSessionDetail } from '@web/hooks/useControlPlaneSessionDetail';
import { useWorkbenchNavigation } from '@web/hooks/useWorkbenchNavigation';
import { AppFrame } from '@web/layout/AppFrame';
import { AppRoutes } from '@web/layout/AppRoutes';
import { toast } from '@web/components/ui/use-toast';
import { APP_ROUTES, SETTINGS_ROUTES } from '@web/layout/routes';

export function App() {
  const navigation = useWorkbenchNavigation();
  const stateQuery = trpcReact.controlPlane.state.useQuery();
  const lastStateQueryError = useRef<string | undefined>(undefined);
  const lastSessionError = useRef<string | undefined>(undefined);
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

  useEffect(() => {
    if (selectedSessionId || sidebarSessions.length === 0) {
      return;
    }

    setSelectedSessionId(sidebarSessions[0]?.id);
  }, [selectedSessionId, sidebarSessions]);

  useEffect(() => {
    const message = stateQuery.error instanceof Error ? stateQuery.error.message : undefined;
    if (!message) {
      lastStateQueryError.current = undefined;
      return;
    }

    if (lastStateQueryError.current !== message) {
      toast({
        title: 'Failed to load control plane state',
        body: message,
        tone: 'error',
      });
      lastStateQueryError.current = message;
    }
  }, [stateQuery.error]);

  useEffect(() => {
    const message = selectedSession.error;
    if (!message) {
      lastSessionError.current = undefined;
      return;
    }

    if (lastSessionError.current !== message) {
      toast({
        title: 'Failed to load session detail',
        body: message,
        tone: 'error',
      });
      lastSessionError.current = message;
    }
  }, [selectedSession.error]);

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
