import { useWorkbenchNavigation } from '@web/hooks/useWorkbenchNavigation';
import { AppFrame } from '@web/layout/AppFrame';
import { AppRoutes } from '@web/layout/AppRoutes';
import { APP_ROUTES, SETTINGS_ROUTES } from '@web/layout/routes';

export function App() {
  const navigation = useWorkbenchNavigation();

  return (
    <AppFrame
      activeSurfaceId={navigation.activeSurfaceId}
      activeSettingsSectionId={navigation.activeSettingsSectionId}
      appNavigationItems={APP_ROUTES}
      settingsNavigationItems={SETTINGS_ROUTES}
      settingsOpen={navigation.settingsOpen}
      onOpenSettings={navigation.openSettings}
      onCloseSettings={navigation.closeSettings}
    >
      <AppRoutes
        activeSurfaceId={navigation.activeSurfaceId}
        activeSettingsSectionId={navigation.activeSettingsSectionId}
      />
    </AppFrame>
  );
}
