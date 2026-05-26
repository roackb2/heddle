import type { ReactNode } from 'react';
import { ContextInspector } from '@web/components/panels';
import { LIVE_TASK_RUN_ID, TaskRunDetailsPanel } from '@web/components/tasks';
import type { I18nMessageKey } from '@web/i18n';
import type { AppSurfaceId } from '@web/layout/types';
import type { ControlPlaneRightPanelProps } from '@web/hooks/useControlPlaneAppState';

export function getControlPlaneRightPanel({
  activeRouteMode,
  t,
  taskRun,
  workspaceId,
}: ControlPlaneRightPanelProps & { t: (key: I18nMessageKey) => string }) {
  const panels = {
    sessions: {
      ariaLabel: t('inspector.contextAriaLabel'),
      content: <ContextInspector workspaceId={workspaceId} />,
    },
    tasks: {
      ariaLabel: t('tasks.runDetailsAriaLabel'),
      content: (
        <TaskRunDetailsPanel
          error={taskRun.error}
          liveTask={taskRun.liveTask}
          loading={taskRun.loading}
          run={taskRun.selectedRunId === LIVE_TASK_RUN_ID ? null : taskRun.run}
          showingLiveRun={taskRun.selectedRunId === LIVE_TASK_RUN_ID}
        />
      ),
    },
    settings: {
      ariaLabel: '',
      content: null,
    },
  } satisfies Record<AppSurfaceId | 'settings', { ariaLabel: string; content: ReactNode }>;

  return panels[activeRouteMode];
}
