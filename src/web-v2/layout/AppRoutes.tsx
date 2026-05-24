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
  type SessionWorkbenchViewProps,
  type TaskWorkbenchViewProps,
} from '@web/views/WorkbenchView';

interface AppRoutesProps {
  activeSurfaceId: AppSurfaceId;
  activeSettingsSectionId: SettingsSectionId;
  memorySettingsView: MemorySettingsViewProps;
  sessionView: SessionWorkbenchViewProps;
  taskView: TaskWorkbenchViewProps;
}

const routePathBySurface = {
  sessions: (href: string) => [`${href}/:sessionId?`],
  tasks: (href: string) => [href, `${href}/:taskId`, `${href}/:taskId/runs/:runId`],
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
  taskView,
}: AppRoutesProps) {
  const sharedWorkbenchProps = {
    activeSettingsSectionId,
    memorySettingsView,
    sessionView,
    taskView,
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
        <Route
          key={route.id}
          path={route.href}
          element={(
            <WorkbenchView
              {...sharedWorkbenchProps}
              activeSurfaceId={activeSurfaceId}
              activeSettingsSectionId={route.id}
              settingsOpen
            />
          )}
        />
      ))}
      <Route path="*" element={<Navigate to={DEFAULT_APP_ROUTE} replace />} />
    </Routes>
  );
}
