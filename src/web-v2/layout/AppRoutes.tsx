import { Navigate, Route, Routes } from 'react-router';
import {
  APP_ROUTES,
  DEFAULT_APP_ROUTE,
  SETTINGS_ROUTES,
} from '@web/layout/routes';
import type {
  ControlPlaneApprovalDecision,
  ControlPlanePendingApproval,
  ControlPlaneSessionDetail,
} from '@web/hooks/useControlPlaneSessionDetail';
import type { AppSurfaceId, SettingsSectionId } from '@web/layout/types';
import { WorkbenchView } from '@web/views/WorkbenchView';

interface AppRoutesProps {
  activeSurfaceId: AppSurfaceId;
  activeSettingsSectionId: SettingsSectionId;
  selectedSession: ControlPlaneSessionDetail;
  selectedSessionLoading: boolean;
  selectedSessionSubmitting: boolean;
  selectedSessionLiveStatus?: string;
  selectedSessionPendingApproval: ControlPlanePendingApproval;
  selectedSessionApprovalResolving: boolean;
  selectedSessionApprovalError?: string;
  onSubmitSessionPrompt: (prompt: string) => Promise<void>;
  onResolveSessionApproval: (decision: ControlPlaneApprovalDecision) => Promise<void>;
}

// AppRoutes renders route config into v2 workbench views. Keep route inventory
// and route rendering here so App remains only shell composition.
export function AppRoutes({
  activeSurfaceId,
  activeSettingsSectionId,
  selectedSession,
  selectedSessionLoading,
  selectedSessionSubmitting,
  selectedSessionLiveStatus,
  selectedSessionPendingApproval,
  selectedSessionApprovalResolving,
  selectedSessionApprovalError,
  onSubmitSessionPrompt,
  onResolveSessionApproval,
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
              selectedSessionLiveStatus={selectedSessionLiveStatus}
              selectedSessionPendingApproval={selectedSessionPendingApproval}
              selectedSessionApprovalResolving={selectedSessionApprovalResolving}
              selectedSessionApprovalError={selectedSessionApprovalError}
              settingsOpen={false}
              onSubmitSessionPrompt={onSubmitSessionPrompt}
              onResolveSessionApproval={onResolveSessionApproval}
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
              selectedSessionLiveStatus={selectedSessionLiveStatus}
              selectedSessionPendingApproval={selectedSessionPendingApproval}
              selectedSessionApprovalResolving={selectedSessionApprovalResolving}
              selectedSessionApprovalError={selectedSessionApprovalError}
              settingsOpen
              onSubmitSessionPrompt={onSubmitSessionPrompt}
              onResolveSessionApproval={onResolveSessionApproval}
            />
          )}
        />
      ))}
      <Route path="*" element={<Navigate to={DEFAULT_APP_ROUTE} replace />} />
    </Routes>
  );
}
