import { HeartbeatSchedulerService } from '../scheduler/index.js';
import type {
  HeartbeatTargetedTaskInvocation,
  HeartbeatTargetedTaskInvocationTarget,
  HeartbeatTargetedTaskWorkerOptions,
} from './types.js';

/** Executes one routed task through Heddle's claim-fenced task pipeline. */
export class HeartbeatTargetedTaskWorker
implements HeartbeatTargetedTaskInvocationTarget {
  constructor(private readonly options: HeartbeatTargetedTaskWorkerOptions) {}

  async invoke(invocation: HeartbeatTargetedTaskInvocation) {
    const { store, handler, ...executionOptions } = this.options;
    return await HeartbeatSchedulerService.runTask({
      ...executionOptions,
      store,
      handler,
      taskId: invocation.taskId,
      executionOwnerId: invocation.invocationId,
      signal: invocation.signal,
    });
  }
}
