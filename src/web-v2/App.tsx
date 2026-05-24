import { TaskCreateDialog, TaskDeleteDialog } from '@web/components/tasks';
import { useControlPlaneAppState } from '@web/hooks/useControlPlaneAppState';
import { useI18n } from '@web/i18n';
import { AppFrame } from '@web/layout/AppFrame';
import { AppRoutes } from '@web/layout/AppRoutes';
import { getControlPlaneRightPanel } from '@web/layout/ControlPlaneRightPanel';
import { APP_ROUTES, SETTINGS_ROUTES } from '@web/layout/routes';

export function App() {
  const app = useControlPlaneAppState();
  const { t } = useI18n();
  const rightPanel = getControlPlaneRightPanel({ ...app.rightPanelProps, t });

  return (
    <AppFrame
      appNavigationItems={APP_ROUTES}
      rightPanel={rightPanel.content}
      rightPanelAriaLabel={rightPanel.ariaLabel}
      settingsNavigationItems={SETTINGS_ROUTES}
      {...app.frameProps}
    >
      <AppRoutes {...app.routeProps} />
      <TaskCreateDialog {...app.taskCreateDialogProps} />
      <TaskCreateDialog {...app.taskEditDialogProps} />
      <TaskDeleteDialog {...app.taskDeleteDialogProps} />
    </AppFrame>
  );
}
