import { useState } from 'react';
import type { AppSurfaceId, SettingsSectionId } from '../layout/types';

// useWorkbenchNavigation owns only local shell navigation state. Server-backed
// workflow state should stay in API-backed feature hooks as v2 grows.
export function useWorkbenchNavigation() {
  const [activeSurfaceId, setActiveSurfaceId] = useState<AppSurfaceId>('sessions');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeSettingsSectionId, setActiveSettingsSectionId] = useState<SettingsSectionId>('general');

  return {
    activeSurfaceId,
    activeSettingsSectionId,
    settingsOpen,
    closeSettings() {
      setSettingsOpen(false);
    },
    openSettings() {
      setSettingsOpen(true);
    },
    openSettingsSection(id: SettingsSectionId) {
      setActiveSettingsSectionId(id);
    },
    openSurface(id: AppSurfaceId) {
      setActiveSurfaceId(id);
      setSettingsOpen(false);
    },
  };
}
