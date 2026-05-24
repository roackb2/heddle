import { TaskCreateDialog, TaskDeleteDialog } from '@web/components/tasks';
import { useControlPlaneAppState } from '@web/hooks/useControlPlaneAppState';
import { AppFrame } from '@web/layout/AppFrame';
import { AppRoutes } from '@web/layout/AppRoutes';
import { APP_ROUTES, SETTINGS_ROUTES } from '@web/layout/routes';

export function App() {
  const app = useControlPlaneAppState();

  return (
    <AppFrame
      appNavigationItems={APP_ROUTES}
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
