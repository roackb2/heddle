import { useEffect, useMemo } from 'react';
import { trpcReact, type ControlPlaneSessionsEventEnvelope } from '@web/api/client';
import type { useWorkbenchNavigation } from '../useWorkbenchNavigation';
import { applyLiveTaskState } from '../tasks/useControlPlaneTaskLiveState';
import type { useControlPlaneHeartbeatEvents } from '../tasks/useControlPlaneHeartbeatEvents';

type WorkbenchNavigation = ReturnType<typeof useWorkbenchNavigation>;
type HeartbeatEvents = ReturnType<typeof useControlPlaneHeartbeatEvents>;

export function useControlPlaneSidebarData({
  navigation,
  taskEvents,
}: {
  navigation: WorkbenchNavigation;
  taskEvents: HeartbeatEvents;
}) {
  const stateQuery = trpcReact.controlPlane.state.useQuery();
  const sessionsQuery = trpcReact.controlPlane.sessions.useQuery();
  const tasksQuery = trpcReact.controlPlane.heartbeatTasks.useQuery();

  const sessions = useMemo(
    () => sessionsQuery.data?.sessions ?? stateQuery.data?.sessions ?? [],
    [sessionsQuery.data?.sessions, stateQuery.data?.sessions],
  );
  const tasks = useMemo(
    () => (tasksQuery.data?.tasks ?? []).map((task) => applyLiveTaskState(task, taskEvents.liveTasks[task.taskId])),
    [taskEvents.liveTasks, tasksQuery.data?.tasks],
  );

  useEffect(() => {
    if (navigation.selectedSessionId || navigation.settingsOpen || navigation.activeSurfaceId !== 'sessions' || sessions.length === 0) {
      return;
    }

    navigation.selectSession(sessions[0]!.id, { replace: true });
  }, [navigation, sessions]);

  useEffect(() => {
    if (navigation.selectedTaskId || navigation.settingsOpen || navigation.activeSurfaceId !== 'tasks' || tasks.length === 0) {
      return;
    }

    navigation.selectTask(tasks[0]!.taskId, { replace: true });
  }, [navigation, tasks]);

  trpcReact.controlPlane.sessionsEvents.useSubscription(undefined, {
    onData: (event: ControlPlaneSessionsEventEnvelope) => {
      if (event.type !== 'sessions.updated') {
        return;
      }

      void sessionsQuery.refetch();
    },
  });

  return {
    stateQuery,
    sessionsQuery,
    tasksQuery,
    sessions,
    tasks,
  };
}
