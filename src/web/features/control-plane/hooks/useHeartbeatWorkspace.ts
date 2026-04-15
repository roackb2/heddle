import { useEffect, useMemo, useState } from 'react';
import type { ControlPlaneState } from '../../../lib/api';

export type HeartbeatTask = ControlPlaneState['heartbeat']['tasks'][number];
export type HeartbeatRun = ControlPlaneState['heartbeat']['runs'][number];

export type HeartbeatWorkspaceState = {
  selectedTaskId?: string;
  setSelectedTaskId: (taskId: string) => void;
  selectedTask?: HeartbeatTask;
  selectedTaskRuns: HeartbeatRun[];
  selectedRunId?: string;
  setSelectedRunId: (runId: string) => void;
  selectedRun?: HeartbeatRun;
};

export function useHeartbeatWorkspace(
  tasks: ControlPlaneState['heartbeat']['tasks'] | undefined,
  runs: ControlPlaneState['heartbeat']['runs'] | undefined,
): HeartbeatWorkspaceState {
  const [selectedTaskId, setSelectedTaskId] = useState<string | undefined>();
  const [selectedRunId, setSelectedRunId] = useState<string | undefined>();

  useEffect(() => {
    if (!tasks?.length) {
      setSelectedTaskId(undefined);
      return;
    }
    if (!selectedTaskId || !tasks.some((task) => task.taskId === selectedTaskId)) {
      setSelectedTaskId(tasks[0].taskId);
    }
  }, [selectedTaskId, tasks]);

  const selectedTaskRuns = useMemo(() => {
    if (!runs || !selectedTaskId) {
      return [];
    }
    return runs.filter((run) => run.taskId === selectedTaskId);
  }, [runs, selectedTaskId]);

  useEffect(() => {
    if (!selectedTaskRuns.length) {
      setSelectedRunId(undefined);
      return;
    }
    if (!selectedRunId || !selectedTaskRuns.some((run) => run.id === selectedRunId)) {
      setSelectedRunId(selectedTaskRuns[0].id);
    }
  }, [selectedRunId, selectedTaskRuns]);

  const selectedTask = useMemo(
    () => tasks?.find((task) => task.taskId === selectedTaskId),
    [selectedTaskId, tasks],
  );
  const selectedRun = useMemo(
    () => selectedTaskRuns.find((run) => run.id === selectedRunId) ?? selectedTaskRuns[0],
    [selectedRunId, selectedTaskRuns],
  );

  return {
    selectedTaskId,
    setSelectedTaskId,
    selectedTask,
    selectedTaskRuns,
    selectedRunId,
    setSelectedRunId,
    selectedRun,
  };
}
