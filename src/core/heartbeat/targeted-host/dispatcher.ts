import { randomUUID } from 'node:crypto';
import { HeartbeatTaskCancellationPolicy } from '../scheduler/cancellation-policy.js';
import {
  HeartbeatTaskExecutionEligibilityPolicy,
  type HeartbeatTaskRunRequestSignal,
} from '../tasks/index.js';
import type {
  HeartbeatTargetedTaskDispatchDecision,
  HeartbeatTargetedTaskDispatchError,
  HeartbeatTargetedTaskDispatchOutcome,
  HeartbeatTargetedTaskDispatcherOptions,
  HeartbeatTargetedTaskInvocation,
  HeartbeatTargetedTaskLocalCancellationResult,
  HeartbeatTargetedTaskNotificationResult,
  StartHeartbeatTargetedTaskDispatcherOptions,
  StopHeartbeatTargetedTaskDispatcherOptions,
} from './types.js';

type DispatcherState = 'idle' | 'running' | 'stopping' | 'stopped';
type DrainDisposition = 'drained' | 'paused' | 'saturated' | 'stopped';

type ActiveInvocation = {
  invocation: HeartbeatTargetedTaskInvocation;
  controller: AbortController;
  promise: Promise<HeartbeatTargetedTaskDispatchOutcome['result'] | undefined>;
  suppressRetry: boolean;
};

type PendingInvocation = {
  runRequestGeneration?: number;
};

const DEFAULT_CONTENTION_RETRY_MS = 1_000;

/**
 * Low-volume in-process dispatcher for durable targeted heartbeat requests.
 *
 * Notifications are a latency hint; non-overlapping catalog polling is the
 * correctness fallback. Heddle's targeted worker still performs the final due
 * check, atomic claim, checkpoint handling, and claim-fenced settlement.
 */
export class HeartbeatTargetedTaskDispatcher {
  readonly #pending = new Map<string, PendingInvocation>();
  readonly #active = new Map<string, ActiveInvocation>();
  readonly #retryTimers = new Map<string, NodeJS.Timeout>();
  readonly #taskIdPrefix: string | undefined;
  #state: DispatcherState = 'idle';
  #pollTimer: NodeJS.Timeout | undefined;
  #pollPromise: Promise<void> | undefined;
  #drainPromise: Promise<void> | undefined;
  #admissionPaused = false;

  constructor(private readonly options: HeartbeatTargetedTaskDispatcherOptions) {
    assertPositiveInteger(options.pollIntervalMs, 'pollIntervalMs');
    assertPositiveInteger(
      options.maxConcurrentInvocations,
      'maxConcurrentInvocations',
    );
    assertPositiveInteger(options.invocationTimeoutMs, 'invocationTimeoutMs');
    assertPositiveInteger(
      options.contentionRetryMs ?? DEFAULT_CONTENTION_RETRY_MS,
      'contentionRetryMs',
    );
    const prefix = options.taskIdPrefix?.trim();
    if (options.taskIdPrefix !== undefined && !prefix) {
      throw new Error('taskIdPrefix must be omitted or non-empty.');
    }
    this.#taskIdPrefix = prefix;
  }

  /** Starts an immediate durable scan, optionally with admission paused. */
  start(options: StartHeartbeatTargetedTaskDispatcherOptions = {}): void {
    if (this.#state === 'running') {
      return;
    }
    if (this.#state !== 'idle') {
      throw new Error('A stopped targeted task dispatcher cannot restart.');
    }
    this.#state = 'running';
    this.#admissionPaused = options.admissionPaused ?? false;
    this.#schedulePoll(0);
  }

  /** Pauses admission, preserves queued hints, and cancels locally active work. */
  async pause(reason: string): Promise<void> {
    const cancellation = HeartbeatTaskCancellationPolicy.createSignal(reason);
    if (this.#state === 'stopped') {
      return;
    }
    this.#admissionPaused = true;
    this.#clearPollTimer();
    this.#retryTimers.forEach((timer) => clearTimeout(timer));
    this.#retryTimers.clear();

    const active = [...this.#active.values()];
    active.forEach((invocation) => {
      invocation.suppressRetry = true;
      invocation.controller.abort(cancellation);
    });
    await Promise.allSettled(active.map(({ promise }) => promise));
  }

  /** Resumes admission and immediately revisits durable and queued work. */
  resume(): void {
    if (this.#state !== 'running' || !this.#admissionPaused) {
      return;
    }
    this.#admissionPaused = false;
    this.scanNow();
    this.#kickDrain();
  }

  /** Requests a non-overlapping immediate correctness scan. */
  scanNow(): void {
    if (
      this.#state !== 'running'
      || this.#admissionPaused
      || this.#pollPromise
    ) {
      return;
    }
    this.#clearPollTimer();
    this.#schedulePoll(0);
  }

  /** Adds one persisted run request to the low-latency delivery path. */
  notify(
    request: HeartbeatTaskRunRequestSignal,
  ): HeartbeatTargetedTaskNotificationResult {
    if (!this.#isManagedTask(request.taskId)) {
      return { taskId: request.taskId, status: 'not-managed' };
    }
    if (this.#state !== 'running') {
      return { taskId: request.taskId, status: 'not-running' };
    }

    this.#clearRetryTimer(request.taskId);
    const status = this.#enqueue(request.taskId, request.generation);
    this.#kickDrain();
    return { taskId: request.taskId, status };
  }

  /** Cancels and awaits only work owned by this dispatcher process. */
  async cancelTask(
    taskId: string,
    reason: string,
  ): Promise<HeartbeatTargetedTaskLocalCancellationResult> {
    const cancellation = HeartbeatTaskCancellationPolicy.createSignal(reason);
    const removedPending = this.#pending.delete(taskId);
    const removedRetry = this.#clearRetryTimer(taskId);
    const active = this.#active.get(taskId);
    if (!active) {
      return {
        taskId,
        disposition: removedPending || removedRetry ? 'cancelled' : 'not-active',
      };
    }

    active.suppressRetry = true;
    active.controller.abort(cancellation);
    const result = await active.promise;
    return {
      taskId,
      disposition: 'cancelled',
      invocationId: active.invocation.invocationId,
      ...(result ? { result } : {}),
    };
  }

  /** Stops admission and awaits polling, draining, and active settlement. */
  async stop(
    options: StopHeartbeatTargetedTaskDispatcherOptions = {},
  ): Promise<void> {
    if (this.#state === 'stopped') {
      return;
    }
    if (this.#state === 'idle') {
      this.#state = 'stopped';
      return;
    }
    if (this.#state === 'stopping') {
      await this.#awaitOutstanding();
      return;
    }

    this.#state = 'stopping';
    this.#clearPollTimer();
    this.#pending.clear();
    this.#retryTimers.forEach((timer) => clearTimeout(timer));
    this.#retryTimers.clear();

    if (options.cancelActive !== false) {
      const cancellation = HeartbeatTaskCancellationPolicy.createSignal(
        'Targeted heartbeat task dispatcher stopped.',
      );
      this.#active.forEach((invocation) => {
        invocation.suppressRetry = true;
        invocation.controller.abort(cancellation);
      });
    }
    await this.#awaitOutstanding();
    this.#state = 'stopped';
  }

  async #awaitOutstanding(): Promise<void> {
    await Promise.allSettled([
      ...[...this.#active.values()].map(({ promise }) => promise),
      this.#drainPromise,
      this.#pollPromise,
    ].filter((promise) => promise !== undefined));
  }

  #enqueue(
    taskId: string,
    runRequestGeneration: number | undefined,
  ): 'queued' | 'coalesced' {
    const active = this.#active.get(taskId);
    const pending = this.#pending.get(taskId);
    const activeGeneration = active
      ?.invocation.runRequestGeneration;
    const pendingGeneration = pending
      ?.runRequestGeneration;
    const latestGeneration = latestRunRequestGeneration(
      pendingGeneration,
      runRequestGeneration,
    );
    const alreadyRepresented = runRequestGeneration === undefined
      ? active !== undefined || pending !== undefined
      : generationIncludes(activeGeneration, runRequestGeneration)
        || generationIncludes(pendingGeneration, runRequestGeneration);

    if (
      !alreadyRepresented
      || (active === undefined && pending === undefined)
    ) {
      this.#pending.set(taskId, { runRequestGeneration: latestGeneration });
    }
    return alreadyRepresented ? 'coalesced' : 'queued';
  }

  #kickDrain(): void {
    if (
      this.#state !== 'running'
      || this.#admissionPaused
      || this.#drainPromise
      || this.#active.size >= this.options.maxConcurrentInvocations
    ) {
      return;
    }
    const drainPromise = this.#drainPending().then((disposition) => {
      if (this.#drainPromise === drainPromise) {
        this.#drainPromise = undefined;
      }
      if (
        disposition !== 'paused'
        && disposition !== 'stopped'
        && this.#state === 'running'
        && this.#pending.size > 0
        && this.#active.size < this.options.maxConcurrentInvocations
      ) {
        this.#kickDrain();
      }
    });
    this.#drainPromise = drainPromise;
  }

  async #drainPending(): Promise<DrainDisposition> {
    if (!await this.#readAdmissionGate()) {
      return 'paused';
    }
    while (
      this.#state === 'running'
      && !this.#admissionPaused
      && this.#pending.size > 0
      && this.#active.size < this.options.maxConcurrentInvocations
    ) {
      const entry = this.#pending.entries().next().value as
        | [string, PendingInvocation]
        | undefined;
      if (!entry) {
        return 'drained';
      }
      const [taskId, pending] = entry;
      this.#pending.delete(taskId);
      try {
        this.#startInvocation(taskId, pending.runRequestGeneration);
      } catch (error) {
        this.#reportError({ phase: 'invoke', error, taskId });
        this.#scheduleRetry(
          taskId,
          pending.runRequestGeneration,
          this.#contentionRetryMs,
        );
      }
    }
    if (this.#state !== 'running') {
      return 'stopped';
    }
    if (this.#admissionPaused) {
      return 'paused';
    }
    return this.#pending.size > 0 ? 'saturated' : 'drained';
  }

  #startInvocation(
    taskId: string,
    runRequestGeneration: number | undefined,
  ): void {
    const controller = new AbortController();
    const invocation: HeartbeatTargetedTaskInvocation = {
      taskId,
      invocationId: this.options.createInvocationId?.(
        taskId,
        runRequestGeneration,
      ) ?? `heddle-targeted:${randomUUID()}`,
      runRequestGeneration,
      signal: controller.signal,
    };
    const active: ActiveInvocation = {
      invocation,
      controller,
      promise: Promise.resolve(undefined),
      suppressRetry: false,
    };
    this.#active.set(taskId, active);
    const timeout = setTimeout(() => {
      controller.abort(HeartbeatTaskCancellationPolicy.createSignal(
        `Targeted heartbeat invocation exceeded ${this.options.invocationTimeoutMs}ms.`,
      ));
    }, this.options.invocationTimeoutMs);
    timeout.unref();
    active.promise = this.#invoke(active).finally(() => {
      clearTimeout(timeout);
      if (this.#active.get(taskId) === active) {
        this.#active.delete(taskId);
      }
      this.#kickDrain();
    });
  }

  async #invoke(
    active: ActiveInvocation,
  ): Promise<HeartbeatTargetedTaskDispatchOutcome['result'] | undefined> {
    try {
      const result = await this.options.target.invoke(active.invocation);
      const decision = resolveHeartbeatTargetedTaskDispatchDecision(
        result.status,
        this.#contentionRetryMs,
      );
      this.#reportOutcome({
        taskId: active.invocation.taskId,
        invocationId: active.invocation.invocationId,
        runRequestGeneration: active.invocation.runRequestGeneration,
        result,
        decision,
      });
      if (decision.kind === 'retry-transiently' && !active.suppressRetry) {
        this.#scheduleRetry(
          active.invocation.taskId,
          active.invocation.runRequestGeneration,
          decision.delayMs,
        );
      }
      return result;
    } catch (error) {
      this.#reportError({
        phase: 'invoke',
        error,
        taskId: active.invocation.taskId,
        invocationId: active.invocation.invocationId,
      });
      if (!active.suppressRetry) {
        this.#scheduleRetry(
          active.invocation.taskId,
          active.invocation.runRequestGeneration,
          this.#contentionRetryMs,
        );
      }
      return undefined;
    }
  }

  #scheduleRetry(
    taskId: string,
    runRequestGeneration: number | undefined,
    delayMs: number,
  ): void {
    if (
      this.#state !== 'running'
      || this.#admissionPaused
      || this.#pending.has(taskId)
      || this.#retryTimers.has(taskId)
    ) {
      return;
    }
    const timer = setTimeout(() => {
      this.#retryTimers.delete(taskId);
      if (this.#state !== 'running' || this.#admissionPaused) {
        return;
      }
      this.#enqueue(taskId, runRequestGeneration);
      this.#kickDrain();
    }, delayMs);
    timer.unref();
    this.#retryTimers.set(taskId, timer);
  }

  #schedulePoll(delayMs: number): void {
    if (this.#state !== 'running' || this.#admissionPaused) {
      return;
    }
    this.#pollTimer = setTimeout(() => {
      this.#pollTimer = undefined;
      const pollPromise = this.#poll();
      this.#pollPromise = pollPromise;
      void pollPromise.finally(() => {
        if (this.#pollPromise === pollPromise) {
          this.#pollPromise = undefined;
        }
      });
    }, delayMs);
    this.#pollTimer.unref();
  }

  async #poll(): Promise<void> {
    try {
      if (!this.#admissionPaused && await this.#readAdmissionGate()) {
        const now = this.options.now?.() ?? new Date();
        const tasks = await this.options.store.listTasks();
        if (this.#state !== 'running' || this.#admissionPaused) {
          return;
        }
        tasks
          .filter((task) => (
            this.#isManagedTask(task.id)
            && HeartbeatTaskExecutionEligibilityPolicy.isDue(task, now)
          ))
          .forEach((task) => {
            this.#enqueue(task.id, task.state?.runRequest?.generation);
          });
        this.#kickDrain();
      }
    } catch (error) {
      this.#reportError({ phase: 'poll', error });
    } finally {
      this.#schedulePoll(this.options.pollIntervalMs);
    }
  }

  async #readAdmissionGate(): Promise<boolean> {
    try {
      return await (this.options.isAdmissionEnabled?.() ?? true);
    } catch (error) {
      this.#reportError({ phase: 'admission-gate', error });
      return false;
    }
  }

  #clearRetryTimer(taskId: string): boolean {
    const timer = this.#retryTimers.get(taskId);
    if (!timer) {
      return false;
    }
    clearTimeout(timer);
    this.#retryTimers.delete(taskId);
    return true;
  }

  #clearPollTimer(): void {
    if (!this.#pollTimer) {
      return;
    }
    clearTimeout(this.#pollTimer);
    this.#pollTimer = undefined;
  }

  #isManagedTask(taskId: string): boolean {
    return this.#taskIdPrefix === undefined
      || taskId.startsWith(this.#taskIdPrefix);
  }

  #reportOutcome(outcome: HeartbeatTargetedTaskDispatchOutcome): void {
    try {
      this.options.onOutcome?.(outcome);
    } catch (error) {
      this.#reportError({
        phase: 'invoke',
        error,
        taskId: outcome.taskId,
        invocationId: outcome.invocationId,
      });
    }
  }

  #reportError(error: HeartbeatTargetedTaskDispatchError): void {
    try {
      this.options.onError?.(error);
    } catch {
      // Observability callbacks cannot invalidate durable dispatch state.
    }
  }

  get #contentionRetryMs(): number {
    return this.options.contentionRetryMs ?? DEFAULT_CONTENTION_RETRY_MS;
  }
}

/** Maps one durable Heddle outcome to host delivery settlement. */
export function resolveHeartbeatTargetedTaskDispatchDecision(
  status: HeartbeatTargetedTaskDispatchOutcome['result']['status'],
  contentionRetryMs: number,
): HeartbeatTargetedTaskDispatchDecision {
  if (status === 'busy' || status === 'claim-lost') {
    return { kind: 'retry-transiently', delayMs: contentionRetryMs };
  }
  if (
    status === 'retry'
    || status === 'failed'
    || status === 'not-due'
    || status === 'admission-closed'
    || status === 'cancelled'
  ) {
    return { kind: 'wait-for-durable-schedule' };
  }
  return { kind: 'complete-delivery' };
}

function latestRunRequestGeneration(
  current: number | undefined,
  candidate: number | undefined,
): number | undefined {
  if (current === undefined) {
    return candidate;
  }
  if (candidate === undefined) {
    return current;
  }
  return Math.max(current, candidate);
}

function generationIncludes(
  current: number | undefined,
  candidate: number | undefined,
): boolean {
  return candidate !== undefined
    && current !== undefined
    && current >= candidate;
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
}
