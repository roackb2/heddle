import { useCallback, useState } from 'react';
import { skipToken } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { trpcReact, type ControlPlaneHeartbeatEventEnvelope, type ControlPlaneHeartbeatTaskView } from '@web/api/client';

type HeartbeatEventEnvelope = Extract<ControlPlaneHeartbeatEventEnvelope, { type: 'heartbeat.event' }>;
type HeartbeatEvent = HeartbeatEventEnvelope['event'];
type HeartbeatTaskEvent = Extract<HeartbeatEvent, { taskId: string }>;
type HeartbeatAgentEvent = Extract<HeartbeatTaskEvent, { type: 'heartbeat.task.agent_event' }>['event'];

export type ControlPlaneLiveTaskState = {
  taskId: string;
  status: ControlPlaneHeartbeatTaskView['state']['status'];
  progress: string;
  runId?: string;
  updatedAt: string;
};

export function useControlPlaneHeartbeatEvents({
  enabled,
  workspaceId,
}: {
  enabled: boolean;
  workspaceId?: string;
}) {
  const utils = trpcReact.useUtils();
  const [liveTasks, setLiveTasks] = useState<Record<string, ControlPlaneLiveTaskState>>({});

  const applyHeartbeatEnvelope = useCallback((envelope: ControlPlaneHeartbeatEventEnvelope) => {
    if (envelope.type !== 'heartbeat.event') {
      return;
    }

    const event = envelope.event;
    if (!hasTaskId(event)) {
      return;
    }

    setLiveTasks((current) => applyHeartbeatEvent(current, event));

    if (event.type === 'heartbeat.task.finished') {
      void utils.controlPlane.heartbeatTasks.invalidate(workspaceId ? { workspaceId } : undefined);
      void utils.controlPlane.heartbeatTask.invalidate(workspaceId ? { workspaceId, taskId: event.taskId } : { taskId: event.taskId });
      void utils.controlPlane.state.invalidate();
      void utils.controlPlane.heartbeatRun.invalidate({
        workspaceId,
        taskId: event.taskId,
        runId: event.record.runId,
      });
    }

    if (event.type === 'heartbeat.task.failed') {
      void utils.controlPlane.heartbeatTasks.invalidate(workspaceId ? { workspaceId } : undefined);
      void utils.controlPlane.heartbeatTask.invalidate(workspaceId ? { workspaceId, taskId: event.taskId } : { taskId: event.taskId });
      void utils.controlPlane.state.invalidate();
    }
  }, [utils, workspaceId]);

  trpcReact.controlPlane.heartbeatEvents.useSubscription(enabled && workspaceId ? { workspaceId } : skipToken, {
    onData: applyHeartbeatEnvelope,
  });

  const markTaskRunQueued = useCallback((taskId: string) => {
    const timestamp = dayjs().toISOString();
    setLiveTasks((current) => ({
      ...current,
      [taskId]: {
        taskId,
        status: 'waiting',
        progress: 'Task queued. Starting heartbeat runner...',
        updatedAt: timestamp,
      },
    }));
  }, []);

  return {
    liveTasks,
    markTaskRunQueued,
  };
}

function applyHeartbeatEvent(
  current: Record<string, ControlPlaneLiveTaskState>,
  event: HeartbeatTaskEvent,
): Record<string, ControlPlaneLiveTaskState> {
  const currentTask = current[event.taskId];
  const timestamp = 'timestamp' in event && typeof event.timestamp === 'string' ? event.timestamp : dayjs().toISOString();
  const base = {
    taskId: event.taskId,
    status: currentTask?.status ?? 'waiting',
    progress: currentTask?.progress ?? '',
    runId: currentTask?.runId,
    updatedAt: timestamp,
  } satisfies ControlPlaneLiveTaskState;

  const next = projectHeartbeatTaskEvent(event, base);

  return {
    ...current,
    [event.taskId]: next,
  };
}

function projectHeartbeatTaskEvent(
  event: HeartbeatTaskEvent,
  base: ControlPlaneLiveTaskState,
): ControlPlaneLiveTaskState {
  switch (event.type) {
    case 'heartbeat.task.due':
      return {
        ...base,
        status: 'waiting',
        progress: 'Task is due. Waiting for the heartbeat runner...',
      };
    case 'heartbeat.task.started':
      return {
        ...base,
        status: 'running',
        progress: event.progress || 'Heartbeat runner started.',
      };
    case 'heartbeat.task.agent_event':
      return {
        ...base,
        status: 'running',
        progress: describeAgentEvent(event.event),
        runId: 'runId' in event.event && typeof event.event.runId === 'string' ? event.event.runId : base.runId,
      };
    case 'heartbeat.task.finished':
      return {
        ...base,
        status: event.record.task.state.status,
        progress: event.record.task.state.progress ?? 'Heartbeat runner finished.',
        runId: event.record.runId,
      };
    case 'heartbeat.task.failed':
      return {
        ...base,
        status: 'failed',
        progress: event.error,
      };
  }
}

function hasTaskId(event: HeartbeatEvent): event is HeartbeatTaskEvent {
  return 'taskId' in event;
}

function describeAgentEvent(event: HeartbeatAgentEvent): string {
  if (!event || typeof event !== 'object' || !('type' in event)) {
    return 'Heartbeat runner is working...';
  }

  const type = String(event.type);
  const descriptions: Record<string, () => string> = {
    'assistant.stream': () => ('done' in event && event.done ? 'Assistant response complete.' : 'Receiving assistant response...'),
    'tool.calling': () => `Running ${'tool' in event && typeof event.tool === 'string' ? event.tool : 'tool'}...`,
    'tool.completed': () => `${'tool' in event && typeof event.tool === 'string' ? event.tool : 'Tool'} finished.`,
    'tool.approval_requested': () => 'Approval required before the task can continue.',
    'heartbeat.decision': () => `Heartbeat decision: ${'decision' in event && typeof event.decision === 'string' ? event.decision : 'continue'}.`,
    'checkpoint.saved': () => 'Checkpoint saved.',
    'loop.started': () => 'Heartbeat runner started.',
    'loop.finished': () => 'Finalizing heartbeat run...',
  };

  return descriptions[type]?.() ?? 'Heartbeat runner is working...';
}
