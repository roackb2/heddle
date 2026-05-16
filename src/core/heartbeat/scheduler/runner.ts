/**
 * Heartbeat task runner service.
 *
 * Translates durable task settings into one wake-service request. Task runtime
 * overrides intentionally share the wake-service vocabulary so this boundary
 * only adds the durable task text and checkpoint.
 */
import type { AgentLoopCheckpoint, AgentLoopState } from '@/core/runtime/loop/index.js';
import { HeartbeatWakeService } from '../wake/index.js';
import type { AgentHeartbeatResult, RunAgentHeartbeatOptions } from '../wake/index.js';
import type { HeartbeatTask } from '../tasks/index.js';

export class HeartbeatTaskRunnerService {
  static async run(args: {
    task: HeartbeatTask;
    checkpoint: AgentLoopState | AgentLoopCheckpoint | undefined;
    heartbeat?: Omit<RunAgentHeartbeatOptions, 'task' | 'checkpoint'>;
  }): Promise<AgentHeartbeatResult> {
    const runtime = HeartbeatTaskRunnerService.resolveRuntime(args);
    return await HeartbeatWakeService.run(runtime);
  }

  private static resolveRuntime(args: {
    task: HeartbeatTask;
    checkpoint: AgentLoopState | AgentLoopCheckpoint | undefined;
    heartbeat?: Omit<RunAgentHeartbeatOptions, 'task' | 'checkpoint'>;
  }): RunAgentHeartbeatOptions {
    return {
      ...args.heartbeat,
      ...args.task.runtime,
      task: args.task.task,
      checkpoint: args.checkpoint,
    };
  }
}
