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
import type {
  ConversationRunAccepted,
  ConversationRunAddress,
  ConversationRunContext,
  ConversationRunHandle,
  ConversationRunServiceOptions,
  ConversationRunStreamItem,
  PendingConversationRunApproval,
  StartConversationContinueRunInput,
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

  async startAndWait<Result>(input: StartConversationRunInput<Address, Result>): Promise<Result> {
    return await this.startRecord(input).record.result;
  }

  startTurn(input: StartConversationTurnRunInput<Address>): ConversationRunHandle<Address, SubmitConversationTurnResult> {
    const started = this.startRecord({
      address: input.address,
      onAccepted: input.onAccepted,
      onHeartbeat: input.onHeartbeat,
      onError: input.onError,
      onSettled: input.onSettled,
      execute: async (run) => await input.engine.turns.submit({
        ...input.turn,
        abortSignal: ConversationRunService.combineAbortSignals(run.controller.signal, input.turn.abortSignal),
        shouldStop: ConversationRunService.combineShouldStop(run.controller.signal, input.turn.shouldStop),
        host: ConversationRunService.withActivityPublisher(input.turn.host, run.publishActivity),
      }),
    });
    return this.createHandle(started.accepted, started.record.result);
  }

  startContinue(input: StartConversationContinueRunInput<Address>): ConversationRunHandle<Address, SubmitConversationTurnResult> {
    const started = this.startRecord({
      address: input.address,
      onAccepted: input.onAccepted,
      onHeartbeat: input.onHeartbeat,
      onError: input.onError,
      onSettled: input.onSettled,
      execute: async (run) => await input.engine.turns.continue({
        ...input.turn,
        abortSignal: ConversationRunService.combineAbortSignals(run.controller.signal, input.turn.abortSignal),
        shouldStop: ConversationRunService.combineShouldStop(run.controller.signal, input.turn.shouldStop),
        host: ConversationRunService.withActivityPublisher(input.turn.host, run.publishActivity),
      }),
    });
    return this.createHandle(started.accepted, started.record.result);
  }

  subscribe<Result>(input: SubscribeConversationRunInput<Address>): AsyncIterable<ConversationRunStreamItem<Result>> {
    const record = this.requireRetainedRun<Result>(input.address, input.runId);
    const afterSequence = input.afterSequence ?? 0;
    const oldestSequence = record.events[0]?.sequence;
    if (oldestSequence !== undefined && afterSequence < oldestSequence - 1) {
      throw new Error(
        `Conversation run replay cursor ${afterSequence} is older than retained sequence ${oldestSequence}.`,
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

  private startRecord<Result>(input: StartConversationRunInput<Address, Result>): {
    accepted: ConversationRunAccepted<Address>;
    record: ConversationRunRecord<Address, Result>;
  } {
    const addressKey = this.addressKey(input.address);
    if (this.activeRuns.has(addressKey)) {
      throw new Error('A run is already in progress for this session.');
    }

    const runId = this.createRunId();
    const acceptedAt = this.now().toISOString();
    let accepted = false;
    let acceptanceError: unknown;
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
    const result = Promise.resolve()
      .then(() => {
        if (!accepted) {
          throw acceptanceError ?? new Error(`Accepted run never started: ${runId}`);
        }

        return input.execute(context);
      })
      .then((value) => {
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
        if (context.controller.signal.aborted) {
          this.publish(record, { kind: 'cancelled', reason: 'Cancelled by user' });
        } else {
          this.publish(record, {
            kind: 'error',
            error: {
              code: 'run_failed',
              message: error instanceof Error ? error.message : String(error),
            },
          });
        }
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
    const record: ConversationRunRecord<Address, Result> = {
      address: input.address,
      addressKey,
      context,
      result,
      events: [],
      subscribers: new Set<RuntimeSubscriptionSink<ConversationRunStreamItem<Result>>>(),
      nextSequence: 1,
      settled: false,
    };
    this.activeRuns.set(addressKey, record as ConversationRunRecord<Address>);
    this.runsById.set(runId, record as ConversationRunRecord<Address>);
    result.catch(() => undefined);

    try {
      input.onAccepted?.(context);
      stopHeartbeat = this.startHeartbeat(context, input.onHeartbeat);
      accepted = true;
    } catch (error) {
      acceptanceError = error;
      this.pendingApprovals.delete(addressKey);
      this.activeRuns.delete(addressKey);
      this.runsById.delete(runId);
      throw error;
    }

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
      throw new Error(`Conversation run not found: ${runId}`);
    }
    return record as ConversationRunRecord<Address, Result>;
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
    return `${address.scopeId}:${address.sessionId}`;
  }
}
