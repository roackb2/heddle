/**
 * Lucid heartbeat presenter.
 *
 * Adapts heartbeat task, run, and scheduler projections into Lucid-style agent
 * notifications. This is an integration projection, not scheduler policy.
 */
import type { HeartbeatSchedulerEvent } from '../scheduler/index.js';
import type { HeartbeatTaskStatus } from '../tasks/index.js';
import type {
  HeartbeatRunView,
  HeartbeatTaskView,
  LucidAdapterOptions,
  LucidAgentMessage,
  LucidAgentStatus,
} from './types.js';

export class HeartbeatLucidPresenter {
  static taskStatusToLucidStatus(status: HeartbeatTaskStatus): LucidAgentStatus {
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

  static taskViewToMessages(
    task: HeartbeatTaskView,
    options: LucidAdapterOptions = {},
  ): LucidAgentMessage[] {
    const agentId = HeartbeatLucidPresenter.resolveAgentId(task.taskId, options);
    const timestamp = task.lastRunAt ?? task.nextRunAt ?? new Date().toISOString();
    const messages: LucidAgentMessage[] = [
      HeartbeatLucidPresenter.statusMessage(agentId, HeartbeatLucidPresenter.taskStatusToLucidStatus(task.status), timestamp),
    ];

    if (task.progress) {
      messages.push(HeartbeatLucidPresenter.progressMessage(agentId, task.progress, timestamp));
    }

    if (task.summary) {
      messages.push(HeartbeatLucidPresenter.responseMessage(agentId, task.summary, timestamp));
    }

    return messages;
  }

  static runViewToMessages(
    run: HeartbeatRunView,
    options: LucidAdapterOptions = {},
  ): LucidAgentMessage[] {
    const agentId = HeartbeatLucidPresenter.resolveAgentId(run.taskId, options);
    const timestamp = run.createdAt;
    const messages: LucidAgentMessage[] = [
      HeartbeatLucidPresenter.statusMessage(agentId, HeartbeatLucidPresenter.taskStatusToLucidStatus(run.status), timestamp),
    ];

    if (run.progress) {
      messages.push(HeartbeatLucidPresenter.progressMessage(agentId, run.progress, timestamp));
    }

    messages.push(HeartbeatLucidPresenter.responseMessage(agentId, run.summary, timestamp));
    return messages;
  }

  static schedulerEventToMessages(
    event: HeartbeatSchedulerEvent,
    options: LucidAdapterOptions = {},
  ): LucidAgentMessage[] {
    if (event.type === 'heartbeat.scheduler.started' || event.type === 'heartbeat.scheduler.stopped') {
      return [];
    }

    const agentId = HeartbeatLucidPresenter.resolveAgentId(event.taskId, options);

    switch (event.type) {
      case 'heartbeat.task.due':
        return [];
      case 'heartbeat.task.started':
        return [
          HeartbeatLucidPresenter.statusMessage(agentId, HeartbeatLucidPresenter.taskStatusToLucidStatus(event.status), event.timestamp),
          HeartbeatLucidPresenter.progressMessage(agentId, event.progress, event.timestamp),
        ];
      case 'heartbeat.task.finished': {
        const { task, result } = event.record;
        return [
          HeartbeatLucidPresenter.statusMessage(agentId, HeartbeatLucidPresenter.taskStatusToLucidStatus(task.state?.status ?? 'waiting'), event.timestamp),
          HeartbeatLucidPresenter.progressMessage(agentId, task.state?.progress ?? '', event.timestamp),
          HeartbeatLucidPresenter.responseMessage(agentId, result.summary, event.timestamp),
        ];
      }
      case 'heartbeat.task.failed':
        return [
          HeartbeatLucidPresenter.statusMessage(agentId, HeartbeatLucidPresenter.taskStatusToLucidStatus(event.status), event.timestamp),
          HeartbeatLucidPresenter.progressMessage(agentId, event.progress, event.timestamp),
          HeartbeatLucidPresenter.responseMessage(agentId, event.error, event.timestamp),
        ];
    }
  }

  private static statusMessage(agentId: string, status: LucidAgentStatus, timestamp: string): LucidAgentMessage {
    return {
      event: 'agent_status',
      data: {
        status: {
          agent_id: agentId,
          status,
          timestamp,
        },
      },
    };
  }

  private static progressMessage(agentId: string, progress: string, timestamp: string): LucidAgentMessage {
    return {
      event: 'agent_progress',
      data: {
        progress: {
          agent_id: agentId,
          progress,
          timestamp,
        },
      },
    };
  }

  private static responseMessage(agentId: string, response: string, timestamp: string): LucidAgentMessage {
    return {
      event: 'agent_response',
      data: {
        response: {
          agent_id: agentId,
          response,
          timestamp,
        },
      },
    };
  }

  private static resolveAgentId(taskId: string, options: LucidAdapterOptions): string {
    return options.taskIdToAgentId?.(taskId) ?? taskId;
  }
}
