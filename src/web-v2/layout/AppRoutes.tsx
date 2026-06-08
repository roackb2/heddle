import { Navigate, Route, Routes } from 'react-router';
import {
  APP_ROUTES,
  DEFAULT_APP_ROUTE,
  SETTINGS_ROUTES,
} from '@web/layout/routes';
import type { AppSurfaceId, SettingsSectionId } from '@web/layout/types';
import {
  WorkbenchView,
  type MemorySettingsViewProps,
  type SkillsSettingsViewProps,
  type SessionWorkbenchViewProps,
  type TaskWorkbenchViewProps,
  type WorkspaceSettingsViewProps,
} from '@web/views/WorkbenchView';

interface AppRoutesProps {
  activeSurfaceId: AppSurfaceId;
  activeSettingsSectionId: SettingsSectionId;
  memorySettingsView: MemorySettingsViewProps;
  sessionView: SessionWorkbenchViewProps;
  skillsSettingsView: SkillsSettingsViewProps;
  taskView: TaskWorkbenchViewProps;
  workspaceSettingsView: WorkspaceSettingsViewProps;
}

const routePathBySurface = {
  sessions: (href: string) => [`${href}/:sessionId?`, `/workspaces/:workspaceId${href}/:sessionId?`],
  tasks: (href: string) => [href, `${href}/:taskId`, `${href}/:taskId/runs/:runId`, `/workspaces/:workspaceId${href}`, `/workspaces/:workspaceId${href}/:taskId`, `/workspaces/:workspaceId${href}/:taskId/runs/:runId`],
} satisfies Record<AppSurfaceId, (href: string) => string[]>;

const appRoutePaths = APP_ROUTES.flatMap((route) => (
  routePathBySurface[route.id](route.href).map((path) => ({
    path,
    surfaceId: route.id,
  }))
));

// AppRoutes renders route config into v2 workbench views. Keep route inventory
// and route rendering here so App remains only shell composition.
export function AppRoutes({
  activeSurfaceId,
  activeSettingsSectionId,
  memorySettingsView,
  sessionView,
  skillsSettingsView,
  taskView,
  workspaceSettingsView,
}: AppRoutesProps) {
  const sharedWorkbenchProps = {
    activeSettingsSectionId,
    memorySettingsView,
    sessionView,
    skillsSettingsView,
    taskView,
    workspaceSettingsView,
  };

  return (
    <Routes>
      <Route path="/" element={<Navigate to={DEFAULT_APP_ROUTE} replace />} />
      {appRoutePaths.map((route) => (
        <Route
          key={route.path}
          path={route.path}
          element={(
            <WorkbenchView
              {...sharedWorkbenchProps}
              activeSurfaceId={route.surfaceId}
              settingsOpen={false}
            />
          )}
        />
      ))}
      {SETTINGS_ROUTES.map((route) => (
        [route.href, `/workspaces/:workspaceId${route.href}`].map((path) => (
          <Route
            key={path}
            path={path}
            element={(
              <WorkbenchView
                {...sharedWorkbenchProps}
                activeSurfaceId={activeSurfaceId}
                activeSettingsSectionId={route.id}
                settingsOpen
              />
            )}
          />
        ))
      ))}
      <Route path="*" element={<Navigate to={DEFAULT_APP_ROUTE} replace />} />
    </Routes>
  );
}
