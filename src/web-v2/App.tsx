import { useWorkbenchNavigation } from './hooks/useWorkbenchNavigation';
import { AppFrame } from './layout/AppFrame';
import { APP_NAV_ITEMS, SETTINGS_NAV_ITEMS } from './layout/navigation';
import { WorkbenchView } from './views/WorkbenchView';

export function App() {
  const navigation = useWorkbenchNavigation();

  return (
    <AppFrame
      activeSurfaceId={navigation.activeSurfaceId}
      activeSettingsSectionId={navigation.activeSettingsSectionId}
      appNavigationItems={APP_NAV_ITEMS}
      settingsNavigationItems={SETTINGS_NAV_ITEMS}
      settingsOpen={navigation.settingsOpen}
      onAppNavigation={navigation.openSurface}
      onSettingsNavigation={navigation.openSettingsSection}
      onOpenSettings={navigation.openSettings}
      onCloseSettings={navigation.closeSettings}
    >
      <WorkbenchView
        activeSurfaceId={navigation.activeSurfaceId}
        activeSettingsSectionId={navigation.activeSettingsSectionId}
        settingsOpen={navigation.settingsOpen}
      />
    </AppFrame>
  );
}
