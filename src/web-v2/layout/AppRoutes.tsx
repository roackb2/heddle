import { Navigate, Route, Routes } from 'react-router';
import {
  APP_ROUTES,
  DEFAULT_APP_ROUTE,
  SETTINGS_ROUTES,
} from '@web/layout/routes';
import type { AppSurfaceId, SettingsSectionId } from '@web/layout/types';
import { WorkbenchView } from '@web/views/WorkbenchView';

interface AppRoutesProps {
  activeSurfaceId: AppSurfaceId;
  activeSettingsSectionId: SettingsSectionId;
}

// AppRoutes renders route config into v2 workbench views. Keep route inventory
// and route rendering here so App remains only shell composition.
export function AppRoutes({ activeSurfaceId, activeSettingsSectionId }: AppRoutesProps) {
  return (
    <Routes>
      <Route path="/" element={<Navigate to={DEFAULT_APP_ROUTE} replace />} />
      {APP_ROUTES.map((route) => (
        <Route
          key={route.id}
          path={route.href}
          element={(
            <WorkbenchView
              activeSurfaceId={route.id}
              activeSettingsSectionId={activeSettingsSectionId}
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
