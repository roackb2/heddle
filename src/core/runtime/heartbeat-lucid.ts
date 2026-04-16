import type { HeartbeatSchedulerEvent, HeartbeatTaskStatus } from './heartbeat-scheduler.js';
import type { HeartbeatRunView, HeartbeatTaskView } from './heartbeat-views.js';

export type LucidAgentStatus = 'running' | 'paused' | 'asleep' | 'terminated' | 'blocked' | 'failed';

export type LucidAgentStatusNotification = {
  agent_id: string;
  status: string;
  timestamp: string;
};

export type LucidAgentProgressNotification = {
  agent_id: string;
  progress: string;
  timestamp: string;
};

export type LucidAgentResponseNotification = {
  agent_id: string;
  response: string;
  timestamp: string;
};

export type LucidAgentMessage =
  | { event: 'agent_status'; data: { status: LucidAgentStatusNotification } }
  | { event: 'agent_progress'; data: { progress: LucidAgentProgressNotification } }
  | { event: 'agent_response'; data: { response: LucidAgentResponseNotification } };

export type LucidAdapterOptions = {
  taskIdToAgentId?: (taskId: string) => string;
};

export function heartbeatTaskStatusToLucidStatus(status: HeartbeatTaskStatus): LucidAgentStatus {
  switch (status) {
    case 'running':
      return 'running';
    case 'waiting':
    case 'idle':
      return 'asleep';
    case 'complete':
      return 'terminated';
    case 'blocked':
      return 'blocked';
    case 'failed':
      return 'failed';
  }
}

export function heartbeatTaskViewToLucidMessages(
  task: HeartbeatTaskView,
  options: LucidAdapterOptions = {},
): LucidAgentMessage[] {
  const agentId = resolveAgentId(task.taskId, options);
  const timestamp = task.lastRunAt ?? task.nextRunAt ?? new Date().toISOString();
  const messages: LucidAgentMessage[] = [
    {
      event: 'agent_status',
      data: {
        status: {
          agent_id: agentId,
          status: heartbeatTaskStatusToLucidStatus(task.status),
          timestamp,
        },
      },
    },
  ];

  if (task.progress) {
    messages.push({
      event: 'agent_progress',
      data: {
        progress: {
          agent_id: agentId,
          progress: task.progress,
          timestamp,
        },
      },
    });
  }

  if (task.summary) {
    messages.push({
      event: 'agent_response',
      data: {
        response: {
          agent_id: agentId,
          response: task.summary,
          timestamp,
        },
      },
    });
  }

  return messages;
}

export function heartbeatRunViewToLucidMessages(
  run: HeartbeatRunView,
  options: LucidAdapterOptions = {},
): LucidAgentMessage[] {
  const agentId = resolveAgentId(run.taskId, options);
  const timestamp = run.createdAt;
  const messages: LucidAgentMessage[] = [
    {
      event: 'agent_status',
      data: {
        status: {
          agent_id: agentId,
          status: heartbeatTaskStatusToLucidStatus(run.status),
          timestamp,
        },
      },
    },
  ];

  if (run.progress) {
    messages.push({
      event: 'agent_progress',
      data: {
        progress: {
          agent_id: agentId,
          progress: run.progress,
          timestamp,
        },
      },
    });
  }

  messages.push({
    event: 'agent_response',
    data: {
      response: {
        agent_id: agentId,
        response: run.summary,
        timestamp,
      },
    },
  });

  return messages;
}

export function heartbeatSchedulerEventToLucidMessages(
  event: HeartbeatSchedulerEvent,
  options: LucidAdapterOptions = {},
): LucidAgentMessage[] {
  if (event.type === 'heartbeat.scheduler.started' || event.type === 'heartbeat.scheduler.stopped') {
    return [];
  }

  const agentId = resolveAgentId(event.taskId, options);

  switch (event.type) {
    case 'heartbeat.task.due':
      return [];
    case 'heartbeat.task.started':
      return [
        {
          event: 'agent_status',
          data: {
            status: {
              agent_id: agentId,
              status: heartbeatTaskStatusToLucidStatus(event.status),
              timestamp: event.timestamp,
            },
          },
        },
        {
          event: 'agent_progress',
          data: {
            progress: {
              agent_id: agentId,
              progress: event.progress,
              timestamp: event.timestamp,
            },
          },
        },
      ];
    case 'heartbeat.task.finished':
      return [
        {
          event: 'agent_status',
          data: {
            status: {
              agent_id: agentId,
              status: heartbeatTaskStatusToLucidStatus(event.status),
              timestamp: event.timestamp,
            },
          },
        },
        {
          event: 'agent_progress',
          data: {
            progress: {
              agent_id: agentId,
              progress: event.progress,
              timestamp: event.timestamp,
            },
          },
        },
        {
          event: 'agent_response',
          data: {
            response: {
              agent_id: agentId,
              response: event.summary,
              timestamp: event.timestamp,
            },
          },
        },
      ];
    case 'heartbeat.task.failed':
      return [
        {
          event: 'agent_status',
          data: {
            status: {
              agent_id: agentId,
              status: heartbeatTaskStatusToLucidStatus(event.status),
              timestamp: event.timestamp,
            },
          },
        },
        {
          event: 'agent_progress',
          data: {
            progress: {
              agent_id: agentId,
              progress: `${event.progress}${event.error ? ` Error: ${event.error}` : ''}`,
              timestamp: event.timestamp,
            },
          },
        },
      ];
  }
}

function resolveAgentId(taskId: string, options: LucidAdapterOptions): string {
  return options.taskIdToAgentId?.(taskId) ?? taskId;
}
