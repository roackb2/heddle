import { useLocation, useNavigate } from 'react-router';
import {
  resolveAppSurface,
  isSettingsRoute,
  resolveRouteSessionId,
  resolveRouteTaskSelection,
  resolveRouteWorkspaceId,
  resolveSettingsSection,
  routeForAppSurface,
  routeForSettingsSection,
  routeForSession,
  routeForTask,
  routeForTaskRun,
} from '@web/layout/routes';
import type { AppSurfaceId, SettingsSectionId } from '@web/layout/types';

export type WorkbenchRouteMode = AppSurfaceId | 'settings';

// useWorkbenchNavigation maps browser routes to shell navigation state. Server-
// backed workflow state should stay in API-backed feature hooks as v2 grows.
export function useWorkbenchNavigation() {
  const location = useLocation();
  const navigate = useNavigate();
  const selectedWorkspaceId = resolveRouteWorkspaceId(location.pathname);
  const settingsOpen = isSettingsRoute(location.pathname);
  const activeSurfaceId = resolveAppSurface(location.pathname);
  const activeSettingsSectionId = resolveSettingsSection(location.pathname);
  const selectedSessionId = resolveRouteSessionId(location.pathname);
  const taskSelection = resolveRouteTaskSelection(location.pathname);
  const activeRouteMode: WorkbenchRouteMode = settingsOpen ? 'settings' : activeSurfaceId;

  return {
    activeRouteMode,
    activeSurfaceId,
    activeSettingsSectionId,
    selectedWorkspaceId,
    selectedSessionId,
    selectedTaskId: taskSelection.taskId,
    selectedTaskRunId: taskSelection.runId,
    settingsOpen,
    closeSettings() {
      navigate(routeForAppSurface(activeSurfaceId, selectedWorkspaceId));
    },
    openSettings(sectionId: SettingsSectionId = activeSettingsSectionId) {
      navigate(routeForSettingsSection(sectionId, selectedWorkspaceId));
    },
    selectSurface(surfaceId: AppSurfaceId, options?: { replace?: boolean }) {
      navigate(routeForAppSurface(surfaceId, selectedWorkspaceId), { replace: options?.replace ?? false });
    },
    selectWorkspace(workspaceId: string, options?: { replace?: boolean }) {
      const route = settingsOpen
        ? routeForSettingsSection(activeSettingsSectionId, workspaceId)
        : routeForAppSurface(activeSurfaceId, workspaceId);
      navigate(route, { replace: options?.replace ?? false });
    },
    selectSession(sessionId: string, options?: { workspaceId?: string; replace?: boolean }) {
      navigate(routeForSession(options?.workspaceId ?? selectedWorkspaceId, sessionId), { replace: options?.replace ?? false });
    },
    selectTask(taskId: string, options?: { workspaceId?: string; replace?: boolean }) {
      navigate(routeForTask(options?.workspaceId ?? selectedWorkspaceId, taskId), { replace: options?.replace ?? false });
    },
    selectTaskRun(taskId: string, runId: string, options?: { workspaceId?: string; replace?: boolean }) {
      navigate(routeForTaskRun(options?.workspaceId ?? selectedWorkspaceId, taskId, runId), { replace: options?.replace ?? false });
    },
  };
}
