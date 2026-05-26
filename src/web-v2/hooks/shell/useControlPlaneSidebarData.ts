import { useEffect, useMemo, useState } from 'react';
import { skipToken } from '@tanstack/react-query';
import { trpcReact, type ControlPlaneSessionsEventEnvelope } from '@web/api/client';
import type { ControlPlaneState } from '@web/api/client';
import type { useWorkbenchNavigation } from '../useWorkbenchNavigation';
import { applyLiveTaskState } from '../tasks/useControlPlaneTaskLiveState';
import type { useControlPlaneHeartbeatEvents } from '../tasks/useControlPlaneHeartbeatEvents';

type WorkbenchNavigation = ReturnType<typeof useWorkbenchNavigation>;
type HeartbeatEvents = ReturnType<typeof useControlPlaneHeartbeatEvents>;
type SidebarSession = ControlPlaneState['sessions'][number];

export function useControlPlaneSidebarData({
  navigation,
  taskEvents,
}: {
  navigation: WorkbenchNavigation;
  taskEvents: HeartbeatEvents;
}) {
  const stateQuery = trpcReact.controlPlane.state.useQuery(
    navigation.selectedWorkspaceId ? { workspaceId: navigation.selectedWorkspaceId } : undefined,
  );
  const workspaceId = navigation.selectedWorkspaceId ?? stateQuery.data?.activeWorkspaceId;
  const workspaceKnown = Boolean(workspaceId && stateQuery.data?.workspaces.some((workspace) => workspace.id === workspaceId));
  const [loadedSessions, setLoadedSessions] = useState<{
    workspaceId?: string;
    sessions: SidebarSession[];
  }>({ sessions: [] });
  const sessionsQuery = trpcReact.controlPlane.sessions.useQuery(
    workspaceKnown && workspaceId ? { workspaceId } : undefined,
    {
      enabled: workspaceKnown,
    },
  );
  const tasksQuery = trpcReact.controlPlane.heartbeatTasks.useQuery(
    workspaceKnown && workspaceId ? { workspaceId } : undefined,
    {
      enabled: workspaceKnown,
    },
  );

  useEffect(() => {
    if (!workspaceId || !sessionsQuery.data || sessionsQuery.data.workspaceId !== workspaceId) {
      setLoadedSessions({ sessions: [] });
      return;
    }

    setLoadedSessions({
      workspaceId,
      sessions: sessionsQuery.data.sessions,
    });
  }, [sessionsQuery.data, workspaceId]);

  const sessions = useMemo(
    () => loadedSessions.workspaceId === workspaceId ? loadedSessions.sessions : [],
    [loadedSessions, workspaceId],
  );
  const tasks = useMemo(
    () => {
      const taskData = tasksQuery.data;
      if (!taskData || taskData.workspaceId !== workspaceId) {
        return [];
      }

      return taskData.tasks.map((task) => applyLiveTaskState(task, taskEvents.liveTasks[task.taskId]));
    },
    [taskEvents.liveTasks, tasksQuery.data, workspaceId],
  );

  useEffect(() => {
    if (navigation.selectedSessionId || navigation.settingsOpen || navigation.activeSurfaceId !== 'sessions' || sessions.length === 0) {
      return;
    }

    navigation.selectSession(sessions[0]!.id, { workspaceId, replace: true });
  }, [navigation, sessions, workspaceId]);

  useEffect(() => {
    if (navigation.selectedTaskId || navigation.settingsOpen || navigation.activeSurfaceId !== 'tasks' || tasks.length === 0) {
      return;
    }

    navigation.selectTask(tasks[0]!.taskId, { replace: true });
  }, [navigation, tasks]);

  trpcReact.controlPlane.sessionsEvents.useSubscription(workspaceId ? { workspaceId } : skipToken, {
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
    workspaceId,
    sessions,
    tasks,
  };
}
