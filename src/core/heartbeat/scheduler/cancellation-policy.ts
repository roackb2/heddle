import {
  MAX_HEARTBEAT_CANCELLATION_REASON_LENGTH,
  type HeartbeatTask,
} from '../tasks/index.js';
import type { HeartbeatTaskCancellationResult } from './types.js';

class HeartbeatTaskCancellationSignal extends Error {
  readonly #operatorReason: string;

  constructor(operatorReason: string) {
    super('Heartbeat task cancellation requested by its host.');
    this.name = 'HeartbeatTaskCancellationSignal';
    this.#operatorReason = operatorReason;
  }

  get operatorReason(): string {
    return this.#operatorReason;
  }
}

/** Shared operator-cancellation validation and inactive-task classification. */
export class HeartbeatTaskCancellationPolicy {
  static normalizeReason(reason: string): string {
    const normalized = reason.trim().replace(/\s+/g, ' ');
    if (!normalized) {
      throw new Error('Heartbeat cancellation reason cannot be empty.');
    }
    if (normalized.length > MAX_HEARTBEAT_CANCELLATION_REASON_LENGTH) {
      throw new Error(
        `Heartbeat cancellation reason must be at most ${MAX_HEARTBEAT_CANCELLATION_REASON_LENGTH} characters.`,
      );
    }
    return normalized;
  }

  static inactiveDisposition(
    task: HeartbeatTask | undefined,
  ): HeartbeatTaskCancellationResult['disposition'] {
    if (!task) {
      return 'not-found';
    }
    if (task.state?.status === 'running') {
      return 'not-owned';
    }
    if (task.state?.status === 'blocked') {
      return 'blocked';
    }
    if (task.state?.status === 'complete') {
      return 'completed';
    }
    if (!task.enabled) {
      return 'disabled';
    }
    return 'not-running';
  }

  static createSignal(reason: string): Error {
    return new HeartbeatTaskCancellationSignal(this.normalizeReason(reason));
  }

  static readSignalReason(
    signal: AbortSignal | undefined,
  ): string | undefined {
    return signal?.reason instanceof HeartbeatTaskCancellationSignal
      ? signal.reason.operatorReason
      : undefined;
  }
}
