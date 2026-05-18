import { useLocation, useNavigate } from 'react-router';
import {
  resolveAppSurface,
  resolveSettingsSection,
  routeForAppSurface,
  routeForSettingsSection,
} from '@web/layout/routes';

// useWorkbenchNavigation maps browser routes to shell navigation state. Server-
// backed workflow state should stay in API-backed feature hooks as v2 grows.
export function useWorkbenchNavigation() {
  const location = useLocation();
  const navigate = useNavigate();
  const settingsOpen = location.pathname.startsWith('/settings');
  const activeSurfaceId = resolveAppSurface(location.pathname);
  const activeSettingsSectionId = resolveSettingsSection(location.pathname);

  return {
    activeSurfaceId,
    activeSettingsSectionId,
    settingsOpen,
    closeSettings() {
      navigate(routeForAppSurface(activeSurfaceId));
    },
    openSettings() {
      navigate(routeForSettingsSection(activeSettingsSectionId));
    },
  };
}
