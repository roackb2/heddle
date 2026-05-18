import { useState } from 'react';
import { AppFrame } from './layout/AppFrame';
import { APP_NAV_ITEMS, SETTINGS_NAV_ITEMS } from './layout/navigation';
import type { AppSurfaceId, SettingsSectionId } from './layout/types';
import { WorkbenchView } from './views/WorkbenchView';

export function App() {
  const [activeSurfaceId, setActiveSurfaceId] = useState<AppSurfaceId>('sessions');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeSettingsSectionId, setActiveSettingsSectionId] = useState<SettingsSectionId>('general');

  return (
    <AppFrame
      activeSurfaceId={activeSurfaceId}
      activeSettingsSectionId={activeSettingsSectionId}
      appNavigationItems={APP_NAV_ITEMS}
      settingsNavigationItems={SETTINGS_NAV_ITEMS}
      settingsOpen={settingsOpen}
      onAppNavigation={(id) => {
        setActiveSurfaceId(id);
        setSettingsOpen(false);
      }}
      onSettingsNavigation={setActiveSettingsSectionId}
      onOpenSettings={() => {
        setSettingsOpen(true);
      }}
      onCloseSettings={() => {
        setSettingsOpen(false);
      }}
    >
      <WorkbenchView
        activeSurfaceId={activeSurfaceId}
        activeSettingsSectionId={activeSettingsSectionId}
        settingsOpen={settingsOpen}
      />
    </AppFrame>
  );
}
