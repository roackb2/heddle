import { useLocation, useNavigate } from 'react-router';
import {
  resolveAppSurface,
  resolveRouteSessionId,
  resolveRouteTaskSelection,
  resolveSettingsSection,
  routeForAppSurface,
  routeForSettingsSection,
  routeForSession,
  routeForTask,
  routeForTaskRun,
} from '@web/layout/routes';
import type { AppSurfaceId } from '@web/layout/types';

export type WorkbenchRouteMode = AppSurfaceId | 'settings';

// useWorkbenchNavigation maps browser routes to shell navigation state. Server-
// backed workflow state should stay in API-backed feature hooks as v2 grows.
export function useWorkbenchNavigation() {
  const location = useLocation();
  const navigate = useNavigate();
  const settingsOpen = location.pathname.startsWith('/settings');
  const activeSurfaceId = resolveAppSurface(location.pathname);
  const activeSettingsSectionId = resolveSettingsSection(location.pathname);
  const selectedSessionId = resolveRouteSessionId(location.pathname);
  const taskSelection = resolveRouteTaskSelection(location.pathname);
  const activeRouteMode: WorkbenchRouteMode = settingsOpen ? 'settings' : activeSurfaceId;

  return {
    activeRouteMode,
    activeSurfaceId,
    activeSettingsSectionId,
    selectedSessionId,
    selectedTaskId: taskSelection.taskId,
    selectedTaskRunId: taskSelection.runId,
    settingsOpen,
    closeSettings() {
      navigate(routeForAppSurface(activeSurfaceId));
    },
    openSettings() {
      navigate(routeForSettingsSection(activeSettingsSectionId));
    },
    selectSurface(surfaceId: AppSurfaceId, options?: { replace?: boolean }) {
      navigate(routeForAppSurface(surfaceId), { replace: options?.replace ?? false });
    },
    selectSession(sessionId: string, options?: { replace?: boolean }) {
      navigate(routeForSession(sessionId), { replace: options?.replace ?? false });
    },
    selectTask(taskId: string, options?: { replace?: boolean }) {
      navigate(routeForTask(taskId), { replace: options?.replace ?? false });
    },
    selectTaskRun(taskId: string, runId: string, options?: { replace?: boolean }) {
      navigate(routeForTaskRun(taskId, runId), { replace: options?.replace ?? false });
    },
  };
}
