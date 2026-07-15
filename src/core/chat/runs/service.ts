import { randomUUID } from 'node:crypto';
import type {
  ToolApprovalUserDecision,
} from '@/core/approvals/index.js';
import type {
  ConversationEngineHost,
  ContinueConversationTurnInput,
  SubmitConversationTurnInput,
  SubmitConversationTurnResult,
} from '@/core/chat/engine/types.js';
import { SESSION_LEASE_REFRESH_INTERVAL_MS } from '@/core/chat/engine/sessions/leases/index.js';
import type { ConversationActivity } from '@/core/live/index.js';
import { RuntimeSubscriptionStream } from '@/core/runtime/subscriptions/index.js';
import type { RuntimeSubscriptionSink } from '@/core/runtime/subscriptions/index.js';
import {
  ConversationRunCancelledError,
  ConversationRunConflictError,
  ConversationRunNotFoundError,
  ConversationRunReplayUnavailableError,
} from './errors.js';
import type {
  ConversationRunAccepted,
  ConversationRunAddress,
  ConversationRunContext,
  ConversationRunErrorProjector,
  ConversationRunHandle,
  ConversationRunPublicError,
  ConversationRunServiceOptions,
  ConversationRunStreamItem,
  PendingConversationRunApproval,
  StartConversationContinueRunInput,
  StartProjectedConversationContinueRunInput,
  StartProjectedConversationTurnRunInput,
  StartConversationRunInput,
  StartConversationTurnRunInput,
  SubscribeConversationRunInput,
} from './types.js';

const DEFAULT_MAX_EVENTS_PER_RUN = 512;
const DEFAULT_RETENTION_MS = 5 * 60_000;

type ConversationRunStreamPayload<Result> = ConversationRunStreamItem<Result> extends infer Item
  ? Item extends unknown
    ? Omit<Item, 'runId' | 'sequence' | 'timestamp'>
    : never
  : never;

type ConversationRunRecord<Address extends { sessionId: string }, Result = unknown> = {
  address: Address;
  addressKey: string;
  context: ConversationRunContext;
  ready: Promise<void>;
  result: Promise<Result>;
  events: Array<ConversationRunStreamItem<Result>>;
  subscribers: Set<RuntimeSubscriptionSink<ConversationRunStreamItem<Result>>>;
  nextSequence: number;
  settled: boolean;
  retentionTimer?: ReturnType<typeof setTimeout>;
};

type StoredPendingConversationRunApproval = PendingConversationRunApproval & {
  runId?: string;
};

/**
 * Owns process-local conversation run coordination for programmatic hosts.
 *
 * Persisted conversation semantics stay in ConversationEngine. This service
 * owns active run identity, cancellation, approvals, ordered activity delivery,
 * and bounded replay for reconnecting subscribers.
 */
export class ConversationRunService<
  Address extends { sessionId: string } = ConversationRunAddress,
> {
  private readonly pendingApprovals = new Map<string, StoredPendingConversationRunApproval>();
  private readonly activeRuns = new Map<string, ConversationRunRecord<Address>>();
  private readonly runsById = new Map<string, ConversationRunRecord<Address>>();
  private readonly addressKey: (address: Address) => string;
  private readonly maxEventsPerRun: number;
  private readonly retentionMs: number;
  private readonly createRunId: () => string;
  private readonly now: () => Date;
  private readonly heartbeatIntervalMs: number;

  constructor(options: ConversationRunServiceOptions<Address> = {}) {
    this.addressKey = options.addressKey
      ?? ((address) => ConversationRunService.defaultAddressKey(address as Address & ConversationRunAddress));
    this.maxEventsPerRun = options.replay?.maxEventsPerRun ?? DEFAULT_MAX_EVENTS_PER_RUN;
    this.retentionMs = options.replay?.retentionMs ?? DEFAULT_RETENTION_MS;
    this.createRunId = options.createRunId ?? (() => `session-run-${randomUUID()}`);
    this.now = options.now ?? (() => new Date());
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? SESSION_LEASE_REFRESH_INTERVAL_MS;

    if (this.maxEventsPerRun < 1) {
      throw new Error('Conversation run maxEventsPerRun must be at least 1.');
    }
    if (this.retentionMs < 0) {
      throw new Error('Conversation run retentionMs cannot be negative.');
    }
  }

  start<Result>(input: StartConversationRunInput<Address, Result>): ConversationRunAccepted<Address> {
    return this.startRecord(input).accepted;
  }

  /**
   * Registers a run immediately, but only reports it as accepted after the
   * host's async acceptance hook has completed successfully.
   */
  async startAndWaitForAcceptance<Result>(
    input: StartConversationRunInput<Address, Result>,
  ): Promise<ConversationRunAccepted<Address>> {
    const started = this.startRecord(input);
    try {
      await started.record.ready;
      return started.accepted;
    } catch (error) {
      await started.record.result.catch(() => undefined);
      throw error;
    }
  }

  async startAndWait<Result>(input: StartConversationRunInput<Address, Result>): Promise<Result> {
    return await this.startRecord(input).record.result;
  }

  startTurn<Result>(
    input: StartProjectedConversationTurnRunInput<Address, Result>,
  ): ConversationRunHandle<Address, Result>;
  startTurn(
    input: StartConversationTurnRunInput<Address>,
  ): ConversationRunHandle<Address, SubmitConversationTurnResult>;
  startTurn<Result>(
    input: StartConversationTurnRunInput<Address> | StartProjectedConversationTurnRunInput<Address, Result>,
  ): ConversationRunHandle<Address, SubmitConversationTurnResult | Result> {
    const started = this.startRecord({
      address: input.address,
      onAccepted: input.onAccepted,
      onHeartbeat: input.onHeartbeat,
      onError: input.onError,
      projectError: input.projectError,
      onSettled: input.onSettled,
      execute: async (run) => {
        const result = await input.engine.turns.submit({
          ...input.turn,
          abortSignal: ConversationRunService.combineAbortSignals(run.controller.signal, input.turn.abortSignal),
          shouldStop: ConversationRunService.combineShouldStop(run.controller.signal, input.turn.shouldStop),
          host: ConversationRunService.withActivityPublisher(input.turn.host, run.publishActivity),
        });
        return await ConversationRunService.projectTurnResult(input, result, run);
      },
    }, { cancelWinsCompletion: true });
    return this.createHandle(started.accepted, started.record.result);
  }

  startContinue<Result>(
    input: StartProjectedConversationContinueRunInput<Address, Result>,
  ): ConversationRunHandle<Address, Result>;
  startContinue(
    input: StartConversationContinueRunInput<Address>,
  ): ConversationRunHandle<Address, SubmitConversationTurnResult>;
  startContinue<Result>(
    input: StartConversationContinueRunInput<Address> | StartProjectedConversationContinueRunInput<Address, Result>,
  ): ConversationRunHandle<Address, SubmitConversationTurnResult | Result> {
    const started = this.startRecord({
      address: input.address,
      onAccepted: input.onAccepted,
      onHeartbeat: input.onHeartbeat,
      onError: input.onError,
      projectError: input.projectError,
      onSettled: input.onSettled,
      execute: async (run) => {
        const result = await input.engine.turns.continue({
          ...input.turn,
          abortSignal: ConversationRunService.combineAbortSignals(run.controller.signal, input.turn.abortSignal),
          shouldStop: ConversationRunService.combineShouldStop(run.controller.signal, input.turn.shouldStop),
          host: ConversationRunService.withActivityPublisher(input.turn.host, run.publishActivity),
        });
        return await ConversationRunService.projectTurnResult(input, result, run);
      },
    }, { cancelWinsCompletion: true });
    return this.createHandle(started.accepted, started.record.result);
  }

  subscribe<Result>(input: SubscribeConversationRunInput<Address>): AsyncIterable<ConversationRunStreamItem<Result>> {
    const record = this.requireRetainedRun<Result>(input.address, input.runId);
    const afterSequence = input.afterSequence ?? 0;
    const oldestSequence = record.events[0]?.sequence;
    if (oldestSequence !== undefined && afterSequence < oldestSequence - 1) {
      throw new ConversationRunReplayUnavailableError(
        input.runId,
        afterSequence,
        oldestSequence,
      );
    }

    return RuntimeSubscriptionStream.fromSources<ConversationRunStreamItem<Result>>({
      signal: input.signal,
      sources: [
        (sink) => {
          record.events
            .filter((event) => event.sequence > afterSequence)
            .forEach((event) => sink.push(event));
          if (record.settled) {
            sink.close();
            return;
          }

          record.subscribers.add(sink);
          return () => record.subscribers.delete(sink);
        },
      ],
    });
  }

  isRunning(address: Address): boolean {
    return this.activeRuns.has(this.addressKey(address));
  }

  getActiveRun(address: Address): ConversationRunAccepted<Address> | undefined {
    const run = this.activeRuns.get(this.addressKey(address));
    if (!run) {
      return undefined;
    }

    return {
      ...run.address,
      accepted: true,
      runId: run.context.runId,
      acceptedAt: run.context.acceptedAt,
    };
  }

  /**
   * Returns a retained run handle together with its host-defined address.
   * Possession of a run ID is not authorization; hosts must verify the address
   * before exposing the handle to a caller.
   */
  getRetainedRun<Result = unknown>(runId: string): ConversationRunHandle<Address, Result> | undefined {
    const record = this.runsById.get(runId) as ConversationRunRecord<Address, Result> | undefined;
    if (!record) {
      return undefined;
    }

    return this.createHandle({
      ...record.address,
      accepted: true,
      runId: record.context.runId,
      acceptedAt: record.context.acceptedAt,
    }, record.result);
  }

  cancelRun(address: Address, runId?: string): boolean {
    const key = this.addressKey(address);
    const run = this.activeRuns.get(key);
    if (!run || (runId !== undefined && run.context.runId !== runId)) {
      return false;
    }

    run.context.controller.abort();
    const pending = this.pendingApprovals.get(key);
    if (pending) {
      this.pendingApprovals.delete(key);
      pending.resolve({
        type: 'deny',
        reason: 'Cancelled by user',
      });
    }
    return true;
  }

  getPendingApproval(address: Address) {
    return this.pendingApprovals.get(this.addressKey(address))?.approval;
  }

  storePendingApproval(address: Address, pending: PendingConversationRunApproval): void {
    const key = this.addressKey(address);
    this.pendingApprovals.set(key, {
      ...pending,
      runId: this.activeRuns.get(key)?.context.runId,
    });
  }

  clearPendingApproval(address: Address): void {
    this.pendingApprovals.delete(this.addressKey(address));
  }

  resolvePendingApproval(address: Address, decision: ToolApprovalUserDecision, runId?: string): boolean {
    const key = this.addressKey(address);
    const pending = this.pendingApprovals.get(key);
    if (!pending || (runId !== undefined && pending.runId !== runId)) {
      return false;
    }

    this.pendingApprovals.delete(key);
    pending.resolve(decision);
    return true;
  }

  private startRecord<Result>(
    input: StartConversationRunInput<Address, Result>,
    options: { cancelWinsCompletion?: boolean } = {},
  ): {
    accepted: ConversationRunAccepted<Address>;
    record: ConversationRunRecord<Address, Result>;
  } {
    const addressKey = this.addressKey(input.address);
    if (this.activeRuns.has(addressKey)) {
      throw new ConversationRunConflictError(addressKey);
    }

    const runId = this.createRunId();
    const acceptedAt = this.now().toISOString();
    let accepted = false;
    let acceptanceError: unknown;
    let acceptance: void | Promise<void>;
    let stopHeartbeat: (() => void) | undefined;
    const context: ConversationRunContext = {
      runId,
      acceptedAt,
      controller: new AbortController(),
      publishActivity: (activity) => this.publish(record, {
        kind: 'activity',
        activity,
      }),
    };
    const record: ConversationRunRecord<Address, Result> = {
      address: input.address,
      addressKey,
      context,
      ready: undefined as unknown as Promise<void>,
      result: undefined as unknown as Promise<Result>,
      events: [],
      subscribers: new Set<RuntimeSubscriptionSink<ConversationRunStreamItem<Result>>>(),
      nextSequence: 1,
      settled: false,
    };
    this.activeRuns.set(addressKey, record as ConversationRunRecord<Address>);
    this.runsById.set(runId, record as ConversationRunRecord<Address>);

    let ready: Promise<void>;
    try {
      acceptance = input.onAccepted?.(context);
      if (acceptance) {
        ready = Promise.resolve(acceptance).then(() => {
          stopHeartbeat = this.startHeartbeat(context, input.onHeartbeat);
          accepted = true;
        });
      } else {
        stopHeartbeat = this.startHeartbeat(context, input.onHeartbeat);
        accepted = true;
        ready = Promise.resolve();
      }
    } catch (error) {
      acceptanceError = error;
      this.pendingApprovals.delete(addressKey);
      this.activeRuns.delete(addressKey);
      this.runsById.delete(runId);
      throw error;
    }
    record.ready = ready;

    const execute = async (): Promise<Result> => {
      if (!accepted) {
        throw acceptanceError ?? new Error(`Accepted run never started: ${runId}`);
      }
      ConversationRunService.throwIfCancelled(context);
      return await input.execute(context);
    };
    let execution: Promise<Result>;
    try {
      execution = acceptance
        ? ready.then(execute)
        : Promise.resolve(input.execute(context));
    } catch (error) {
      execution = Promise.reject(error);
    }

    const result = execution
      .then((value) => {
        if (options.cancelWinsCompletion) {
          ConversationRunService.throwIfCancelled(context);
        }
        this.publish(record, { kind: 'result', result: value });
        return value;
      })
      .catch(async (error: unknown) => {
        if (accepted) {
          try {
            await input.onError?.(error, context);
          } catch {
            // Run settlement must preserve the execution error and terminal
            // stream item even when a host-side failure hook also fails.
          }
        }
        const publicError = context.controller.signal.aborted
          ? undefined
          : await ConversationRunService.projectRunError(input.projectError, error, context);
        this.publish(record, publicError && !context.controller.signal.aborted
          ? { kind: 'error', error: publicError }
          : { kind: 'cancelled', reason: 'Cancelled by user' });
        throw error;
      })
      .finally(() => {
        stopHeartbeat?.();
        this.pendingApprovals.delete(addressKey);
        this.activeRuns.delete(addressKey);
        this.settle(record);
        if (accepted) {
          void Promise.resolve(input.onSettled?.(context)).catch(() => undefined);
        }
      });
    record.result = result;
    result.catch(() => undefined);

    return {
      accepted: {
        ...input.address,
        accepted: true,
        runId,
        acceptedAt,
      },
      record,
    };
  }

  private createHandle<Result>(
    accepted: ConversationRunAccepted<Address>,
    result: Promise<Result>,
  ): ConversationRunHandle<Address, Result> {
    return {
      ...accepted,
      result,
      events: (options = {}) => this.subscribe({
        address: accepted,
        runId: accepted.runId,
        ...options,
      }),
      cancel: () => this.cancelRun(accepted, accepted.runId),
      resolveApproval: (decision) => this.resolvePendingApproval(accepted, decision, accepted.runId),
    };
  }

  private publish<Result>(
    record: ConversationRunRecord<Address, Result>,
    item: ConversationRunStreamPayload<Result>,
  ): void {
    const event = {
      ...item,
      runId: record.context.runId,
      sequence: record.nextSequence,
      timestamp: this.now().toISOString(),
    } as ConversationRunStreamItem<Result>;
    record.nextSequence += 1;
    record.events.push(event);
    if (record.events.length > this.maxEventsPerRun) {
      record.events.splice(0, record.events.length - this.maxEventsPerRun);
    }
    record.subscribers.forEach((subscriber) => subscriber.push(event));
  }

  private settle(record: ConversationRunRecord<Address>): void {
    record.settled = true;
    record.subscribers.forEach((subscriber) => subscriber.close());
    record.subscribers.clear();

    if (this.retentionMs === 0) {
      this.runsById.delete(record.context.runId);
      return;
    }

    record.retentionTimer = setTimeout(() => {
      this.runsById.delete(record.context.runId);
    }, this.retentionMs);
    record.retentionTimer.unref?.();
  }

  private requireRetainedRun<Result>(address: Address, runId: string): ConversationRunRecord<Address, Result> {
    const record = this.runsById.get(runId);
    if (!record || record.addressKey !== this.addressKey(address)) {
      throw new ConversationRunNotFoundError(runId);
    }
    return record as ConversationRunRecord<Address, Result>;
  }

  private static async projectTurnResult<Result>(
    input:
      | StartConversationTurnRunInput<{ sessionId: string }>
      | StartProjectedConversationTurnRunInput<{ sessionId: string }, Result>
      | StartConversationContinueRunInput<{ sessionId: string }>
      | StartProjectedConversationContinueRunInput<{ sessionId: string }, Result>,
    result: SubmitConversationTurnResult,
    run: ConversationRunContext,
  ): Promise<SubmitConversationTurnResult | Result> {
    ConversationRunService.throwIfCancelled(run);
    if (!('projectResult' in input)) {
      return result;
    }

    const projected = await input.projectResult(result, run);
    ConversationRunService.throwIfCancelled(run);
    return projected;
  }

  private static async projectRunError(
    projectError: ConversationRunErrorProjector | undefined,
    error: unknown,
    run: ConversationRunContext,
  ): Promise<ConversationRunPublicError> {
    if (!projectError) {
      return {
        code: 'run_failed',
        message: error instanceof Error ? error.message : String(error),
      };
    }

    try {
      const projected = await projectError(error, run);
      if (typeof projected.code !== 'string'
        || !projected.code.trim()
        || typeof projected.message !== 'string') {
        throw new Error('Projected conversation run errors require a code and message.');
      }
      return { code: projected.code.trim(), message: projected.message };
    } catch {
      return {
        code: 'run_failed',
        message: 'The conversation run failed.',
      };
    }
  }

  private static throwIfCancelled(run: ConversationRunContext): void {
    if (run.controller.signal.aborted) {
      throw new ConversationRunCancelledError(run.runId);
    }
  }

  private startHeartbeat(
    run: ConversationRunContext,
    onHeartbeat: StartConversationRunInput<Address, unknown>['onHeartbeat'],
  ): (() => void) | undefined {
    if (!onHeartbeat) {
      return undefined;
    }

    let refreshing = false;
    const timer = setInterval(() => {
      if (refreshing || run.controller.signal.aborted) {
        return;
      }

      refreshing = true;
      Promise.resolve()
        .then(() => onHeartbeat(run))
        .catch(() => run.controller.abort())
        .finally(() => {
          refreshing = false;
        });
    }, this.heartbeatIntervalMs);

    return () => clearInterval(timer);
  }

  private static withActivityPublisher(
    host: ConversationEngineHost | undefined,
    publishActivity: (activity: ConversationActivity) => void,
  ): ConversationEngineHost {
    return {
      ...host,
      events: {
        ...host?.events,
        onActivity: (activity) => {
          publishActivity(activity);
          host?.events?.onActivity?.(activity);
        },
      },
    };
  }

  private static combineAbortSignals(primary: AbortSignal, secondary?: AbortSignal): AbortSignal {
    return secondary ? AbortSignal.any([primary, secondary]) : primary;
  }

  private static combineShouldStop(
    signal: AbortSignal,
    shouldStop?: SubmitConversationTurnInput['shouldStop'] | ContinueConversationTurnInput['shouldStop'],
  ) {
    return () => signal.aborted || shouldStop?.() === true;
  }

  private static defaultAddressKey(address: ConversationRunAddress): string {
    if (!address.scopeId?.trim() || !address.sessionId.trim()) {
      throw new Error('Conversation run addresses require non-empty scopeId and sessionId values.');
    }
    return JSON.stringify([address.scopeId, address.sessionId]);
  }
}
