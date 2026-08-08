/**
 * Shared durable eligibility policy for scheduled and targeted heartbeat work.
 *
 * Selection is only an optimization. Stores must evaluate the same policy
 * inside a `due` claim so an operator update between read and claim cannot run
 * disabled, busy, or no-longer-due work.
 */
import dayjs from 'dayjs';
import isSameOrBefore from 'dayjs/plugin/isSameOrBefore.js';
import type { HeartbeatTask } from './types.js';

dayjs.extend(isSameOrBefore);

export type HeartbeatTaskExecutionEligibility =
  | { eligible: true }
  | { eligible: false; reason: 'disabled' | 'busy' | 'not-due' };

export class HeartbeatTaskExecutionEligibilityPolicy {
  static evaluate(task: HeartbeatTask, now: Date): HeartbeatTaskExecutionEligibility {
    if (!task.enabled) {
      return { eligible: false, reason: 'disabled' };
    }
    if (task.state?.status === 'running') {
      return { eligible: false, reason: 'busy' };
    }
    if (!task.schedule.nextRunAt) {
      return { eligible: true };
    }

    const nextRunAt = dayjs(task.schedule.nextRunAt);
    return nextRunAt.isValid() && nextRunAt.isSameOrBefore(dayjs(now)) ?
      { eligible: true }
    : { eligible: false, reason: 'not-due' };
  }

  static isDue(task: HeartbeatTask, now: Date): boolean {
    return HeartbeatTaskExecutionEligibilityPolicy.evaluate(task, now).eligible;
  }
}
