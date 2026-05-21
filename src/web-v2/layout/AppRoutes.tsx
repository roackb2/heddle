import { Navigate, Route, Routes } from 'react-router';
import {
  APP_ROUTES,
  DEFAULT_APP_ROUTE,
  SETTINGS_ROUTES,
} from '@web/layout/routes';
import type { ControlPlaneSessionDetail } from '@web/hooks/useControlPlaneSessionDetail';
import type { AppSurfaceId, SettingsSectionId } from '@web/layout/types';
import { WorkbenchView } from '@web/views/WorkbenchView';

interface AppRoutesProps {
  activeSurfaceId: AppSurfaceId;
  activeSettingsSectionId: SettingsSectionId;
  selectedSession: ControlPlaneSessionDetail;
  selectedSessionLoading: boolean;
  selectedSessionSubmitting: boolean;
  selectedSessionRunning: boolean;
  selectedSessionLiveStatus?: string;
  selectedSessionError?: string;
  onSubmitSessionPrompt: (prompt: string) => Promise<void>;
}

// AppRoutes renders route config into v2 workbench views. Keep route inventory
// and route rendering here so App remains only shell composition.
export function AppRoutes({
  activeSurfaceId,
  activeSettingsSectionId,
  selectedSession,
  selectedSessionLoading,
  selectedSessionSubmitting,
  selectedSessionRunning,
  selectedSessionLiveStatus,
  selectedSessionError,
  onSubmitSessionPrompt,
}: AppRoutesProps) {
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
              selectedSession={selectedSession}
              selectedSessionLoading={selectedSessionLoading}
              selectedSessionSubmitting={selectedSessionSubmitting}
              selectedSessionRunning={selectedSessionRunning}
              selectedSessionLiveStatus={selectedSessionLiveStatus}
              selectedSessionError={selectedSessionError}
              settingsOpen={false}
              onSubmitSessionPrompt={onSubmitSessionPrompt}
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
              selectedSession={selectedSession}
              selectedSessionLoading={selectedSessionLoading}
              selectedSessionSubmitting={selectedSessionSubmitting}
              selectedSessionRunning={selectedSessionRunning}
              selectedSessionLiveStatus={selectedSessionLiveStatus}
              selectedSessionError={selectedSessionError}
              settingsOpen
              onSubmitSessionPrompt={onSubmitSessionPrompt}
            />
          )}
        />
      ))}
      <Route path="*" element={<Navigate to={DEFAULT_APP_ROUTE} replace />} />
    </Routes>
  );
}
