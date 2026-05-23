import { Navigate, Route, Routes } from 'react-router';
import {
  APP_ROUTES,
  DEFAULT_APP_ROUTE,
  SETTINGS_ROUTES,
} from '@web/layout/routes';
import type {
  ControlPlaneApprovalDecision,
  ControlPlaneReasoningEffortSelection,
  ControlPlanePendingApproval,
  ControlPlaneSessionDetail,
} from '@web/hooks/useControlPlaneSessionDetail';
import type {
  ControlPlaneHeartbeatRunView,
  ControlPlaneHeartbeatTask,
  ControlPlaneModelOptions,
} from '@web/api/client';
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
  selectedSessionModelOptions?: ControlPlaneModelOptions;
  selectedSessionSettingsUpdating: boolean;
  selectedSessionSettingsError?: string;
  selectedTask: ControlPlaneHeartbeatTask['task'] | undefined;
  selectedTaskRuns: ControlPlaneHeartbeatRunView[];
  selectedTaskRunId?: string;
  selectedTaskLoading: boolean;
  selectedTaskError?: string;
  selectedTaskRunSubmitting: boolean;
  onSubmitSessionPrompt: (prompt: string) => Promise<void>;
  onUpdateSessionModel: (model: string) => Promise<void>;
  onUpdateSessionReasoningEffort: (value: ControlPlaneReasoningEffortSelection) => Promise<void>;
  onResolveSessionApproval: (decision: ControlPlaneApprovalDecision) => Promise<void>;
  onRunTaskNow: () => Promise<void>;
  onSelectTaskRun: (runId: string) => void;
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
  selectedSession,
  selectedSessionLoading,
  selectedSessionSubmitting,
  selectedSessionLiveStatus,
  selectedSessionPendingApproval,
  selectedSessionApprovalResolving,
  selectedSessionApprovalError,
  selectedSessionModelOptions,
  selectedSessionSettingsUpdating,
  selectedSessionSettingsError,
  selectedTask,
  selectedTaskRuns,
  selectedTaskRunId,
  selectedTaskLoading,
  selectedTaskError,
  selectedTaskRunSubmitting,
  onSubmitSessionPrompt,
  onUpdateSessionModel,
  onUpdateSessionReasoningEffort,
  onResolveSessionApproval,
  onRunTaskNow,
  onSelectTaskRun,
}: AppRoutesProps) {
  const sharedWorkbenchProps = {
    activeSettingsSectionId,
    selectedSession,
    selectedSessionLoading,
    selectedSessionSubmitting,
    selectedSessionLiveStatus,
    selectedSessionPendingApproval,
    selectedSessionApprovalResolving,
    selectedSessionApprovalError,
    selectedSessionModelOptions,
    selectedSessionSettingsUpdating,
    selectedSessionSettingsError,
    selectedTask,
    selectedTaskRuns,
    selectedTaskRunId,
    selectedTaskLoading,
    selectedTaskError,
    selectedTaskRunSubmitting,
    onSubmitSessionPrompt,
    onUpdateSessionModel,
    onUpdateSessionReasoningEffort,
    onResolveSessionApproval,
    onRunTaskNow,
    onSelectTaskRun,
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
