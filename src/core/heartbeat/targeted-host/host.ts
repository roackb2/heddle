import { randomUUID } from 'node:crypto';
import { HeartbeatTaskCancellationPolicy } from '../scheduler/cancellation-policy.js';
import type {
  CancelHeartbeatTaskOptions,
  HeartbeatTaskCancellationResult,
  StopHeartbeatSchedulerOptions,
} from '../scheduler/index.js';
import type { HeartbeatTaskRunRequestSignal } from '../tasks/index.js';
import { HeartbeatTargetedTaskDispatcher } from './dispatcher.js';
import type {
  HeartbeatTargetedTaskHostHandle,
  HeartbeatTargetedTaskHostOptions,
  HeartbeatTargetedTaskNotificationResult,
  StartHeartbeatTargetedTaskHostInput,
} from './types.js';

/**
 * Complete low-volume lifecycle around the targeted dispatcher.
 *
 * It owns run-request subscription, periodic expired-owner recovery,
 * process-local pause/cancellation, and inactive cancellation classification.
 * The store remains the durable authority and the target remains replaceable.
 */
export class HeartbeatTargetedTaskHost
implements HeartbeatTargetedTaskHostHandle {
  readonly #recoveryOwnerId: string;
  #dispatcher: HeartbeatTargetedTaskDispatcher | undefined;
  #unsubscribe: (() => void) | undefined;
  #recoveryTimer: NodeJS.Timeout | undefined;
  #recoveryPromise: Promise<void> | undefined;
  #started = false;
  #paused = false;
  #stopped = false;

  constructor(private readonly options: HeartbeatTargetedTaskHostOptions) {
    assertPositiveInteger(options.recoveryIntervalMs, 'recoveryIntervalMs');
    this.#recoveryOwnerId = options.recoveryOwnerId
      ?? `heddle-targeted-recovery:${randomUUID()}`;
  }

  start(input: StartHeartbeatTargetedTaskHostInput): void {
    if (this.#stopped) {
      throw new Error('A stopped targeted task host cannot restart.');
    }
    if (this.#started) {
      return;
    }

    const {
      store,
      createTarget,
      recoveryIntervalMs: _recoveryIntervalMs,
      recoveryOwnerId: _recoveryOwnerId,
      onRecoveryError: _onRecoveryError,
      ...dispatcherOptions
    } = this.options;
    this.#started = true;
    this.#paused = input.admissionEnabled === false;
    this.#dispatcher = new HeartbeatTargetedTaskDispatcher({
      ...dispatcherOptions,
      store,
      target: createTarget(input.handler),
    });
    this.#dispatcher.start({ admissionPaused: this.#paused });
    this.#unsubscribe = store.subscribeToRunRequests?.(
      (request) => this.notify(request),
    );
    if (!this.#paused) {
      this.#scheduleRecovery(0);
    }
  }

  notify(
    request: HeartbeatTaskRunRequestSignal,
  ): HeartbeatTargetedTaskNotificationResult | undefined {
    return this.#dispatcher?.notify(request);
  }

  async cancelTask(
    taskId: string,
    options: CancelHeartbeatTaskOptions,
  ): Promise<HeartbeatTaskCancellationResult> {
    const reason = HeartbeatTaskCancellationPolicy.normalizeReason(
      options.reason,
    );
    const localResult = await this.#dispatcher?.cancelTask(taskId, reason);
    if (localResult?.disposition === 'cancelled') {
      const result = localResult.result;
      if (result?.status === 'cancelled' && result.executionId) {
        return {
          taskId,
          disposition: 'cancelled',
          reason,
          executionId: result.executionId,
          ...(result.record ? { record: result.record } : {}),
        };
      }
      if (result?.record || result?.failed) {
        const executionId = 'executionId' in result
          ? result.executionId
          : undefined;
        return {
          taskId,
          disposition: 'completion-won',
          reason,
          ...(executionId ? { executionId } : {}),
          ...(result.record ? { record: result.record } : {}),
        };
      }
    }
    const task = await this.options.store.loadTask(taskId);
    return {
      taskId,
      disposition: HeartbeatTaskCancellationPolicy.inactiveDisposition(task),
      reason,
    };
  }

  async pause(options: CancelHeartbeatTaskOptions): Promise<void> {
    const reason = HeartbeatTaskCancellationPolicy.normalizeReason(
      options.reason,
    );
    this.#paused = true;
    this.#clearRecoveryTimer();
    await this.#dispatcher?.pause(reason);
    await this.#recoveryPromise;
  }

  resume(): void {
    if (!this.#started || this.#stopped || !this.#paused) {
      return;
    }
    this.#paused = false;
    this.#dispatcher?.resume();
    this.#scheduleRecovery(0);
  }

  async stop(options: StopHeartbeatSchedulerOptions = {}): Promise<void> {
    if (this.#stopped) {
      return;
    }
    this.#stopped = true;
    this.#paused = true;
    this.#clearRecoveryTimer();
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
    await this.#dispatcher?.stop({
      cancelActive: options.cancelRunning !== false,
    });
    await this.#recoveryPromise;
  }

  #scheduleRecovery(delayMs: number): void {
    if (this.#paused || this.#stopped || this.#recoveryTimer) {
      return;
    }
    this.#recoveryTimer = setTimeout(() => {
      this.#recoveryTimer = undefined;
      const recoveryPromise = this.#recoverExpiredExecutions();
      this.#recoveryPromise = recoveryPromise;
      void recoveryPromise.finally(() => {
        if (this.#recoveryPromise === recoveryPromise) {
          this.#recoveryPromise = undefined;
        }
      });
    }, delayMs);
    this.#recoveryTimer.unref();
  }

  async #recoverExpiredExecutions(): Promise<void> {
    try {
      await this.options.store.recoverInterruptedTasks({
        ownerId: this.#recoveryOwnerId,
        recoveredAt: this.options.now?.() ?? new Date(),
        reason: 'host-restart',
      });
      if (!this.#paused && !this.#stopped) {
        this.#dispatcher?.scanNow();
      }
    } catch (error) {
      try {
        this.options.onRecoveryError?.(error);
      } catch {
        // Observability callbacks cannot invalidate durable recovery state.
      }
    } finally {
      this.#scheduleRecovery(this.options.recoveryIntervalMs);
    }
  }

  #clearRecoveryTimer(): void {
    if (!this.#recoveryTimer) {
      return;
    }
    clearTimeout(this.#recoveryTimer);
    this.#recoveryTimer = undefined;
  }
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
}
