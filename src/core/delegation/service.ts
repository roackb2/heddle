import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { Semaphore } from 'async-mutex';
import cloneDeep from 'lodash/cloneDeep.js';
import truncate from 'lodash/truncate.js';
import {
  CustomAgentService,
} from '@/core/custom-agents/index.js';
import type { CustomAgentExecutionSnapshot } from '@/core/custom-agents/index.js';
import { HeddleEventType } from '@/core/event-types.js';
import type {
  ConversationAgentLoopActivity,
  ConversationDelegationCorrelation,
} from '@/core/live/index.js';
import {
  AgentLoopCheckpointService,
} from '@/core/runtime/loop/index.js';
import type { AgentLoopResult } from '@/core/runtime/loop/index.js';
import type { ToolDefinition, ToolResult } from '@/core/types.js';
import {
  DelegationPolicyService,
  MAX_DELEGATED_SUMMARY_LENGTH,
  MAX_DELEGATED_TASK_LENGTH,
} from './policy.js';
import type {
  CreateDelegationRootScopeOptions,
  DelegateTaskExecutionContext,
  DelegateTaskOutput,
  DelegatedRunRecord,
  DelegationAgentProfileId,
  DelegationAgentSnapshotResolver,
  DelegationPolicy,
  DelegationRejectionCode,
  DelegationRootScopeSnapshot,
  DelegationServiceOptions,
  SettledDelegatedRunRecord,
  SettledDelegationRootScopeSnapshot,
} from './types.js';
import { DelegationChildRuntimeService } from './child-runtime.js';

type ReservedChild = {
  record: DelegatedRunRecord;
  controller: AbortController;
  snapshot: CustomAgentExecutionSnapshot;
};

/**
 * Host-owned delegation configuration. Create one root scope per root run;
 * the service itself keeps no cross-run mutable execution state.
 */
export class DelegationService {
  readonly policy: DelegationPolicy;

  constructor(options: DelegationServiceOptions = {}) {
    this.policy = DelegationPolicyService.resolve(options.policy);
  }

  get enabled(): boolean {
    return this.policy.enabled;
  }

  createRootScope(options: CreateDelegationRootScopeOptions): DelegationRootScope {
    return new DelegationRootScope(this.policy, options);
  }
}

/**
 * Owns one root run's child reservations, scheduling, cancellation, and
 * host-visible records. It never creates chat sessions or a second agent loop.
 */
export class DelegationRootScope {
  readonly rootRunId: string;
  readonly workspaceRoot: string;
  readonly policy: DelegationPolicy;

  private readonly agentSnapshots: ReadonlyMap<DelegationAgentProfileId, CustomAgentExecutionSnapshot>;
  private readonly childRecords: DelegatedRunRecord[] = [];
  private readonly childControllers = new Map<string, AbortController>();
  private readonly childSettlements = new Set<Promise<ToolResult>>();
  private readonly childRuntime: DelegationChildRuntimeService;
  private readonly defaultAgentProfileId: DelegationAgentProfileId;
  private readonly onActivity: CreateDelegationRootScopeOptions['onActivity'];
  private readonly actionSemaphore = new Semaphore(1);
  private readonly semaphore: Semaphore;
  private readonly scopeController = new AbortController();

  constructor(
    policy: DelegationPolicy,
    options: CreateDelegationRootScopeOptions,
  ) {
    this.policy = DelegationPolicyService.resolve(policy);
    this.rootRunId = AgentLoopCheckpointService.resolveRunId(options.rootRunId);
    this.workspaceRoot = resolve(options.workspaceRoot);
    this.onActivity = options.onActivity;
    this.semaphore = new Semaphore(this.policy.maxConcurrentChildren);
    this.childRuntime = new DelegationChildRuntimeService({
      rootRunId: this.rootRunId,
      workspaceRoot: this.workspaceRoot,
      policy: this.policy,
      runtime: options.runtime,
    });

    const resolver = options.agentSnapshotResolver
      ?? new CustomAgentService({
        workspaceRoot: this.workspaceRoot,
        homeDir: options.homeDir,
      });
    this.agentSnapshots = this.policy.enabled
      ? this.resolveAgentSnapshots(resolver)
      : new Map();
    const availableAgentProfileIds = [...this.agentSnapshots.keys()];
    if (this.policy.enabled && availableAgentProfileIds.length === 0) {
      throw new Error('Delegation has no child agent profile within the root authority ceiling');
    }
    this.defaultAgentProfileId = this.agentSnapshots.has('builtin:ask')
      ? 'builtin:ask'
      : availableAgentProfileIds[0] ?? 'builtin:ask';
  }

  /**
   * Creates the only model-visible delegation entry point for this scope.
   */
  createTool(): ToolDefinition {
    const availableAgentProfileIds = [...this.agentSnapshots.keys()];
    return {
      name: 'delegate_task',
      description: [
        'Run one bounded child agent on an independent task.',
        'Ask and Review children are read-only. Explicitly selecting builtin:code grants the child a bounded coding catalog within the root agent tool and permission ceilings.',
        'The child receives the same workspace but no parent transcript and cannot delegate further.',
        `task is required and limited to ${MAX_DELEGATED_TASK_LENGTH} characters.`,
        `agentProfileId may be omitted to use ${this.defaultAgentProfileId}.`,
      ].join(' '),
      capabilities: ['agent.delegate'],
      concurrency: 'parallel-safe',
      timeoutMs: null,
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          task: {
            type: 'string',
            minLength: 1,
            maxLength: MAX_DELEGATED_TASK_LENGTH,
            description: 'Self-contained task for the child agent.',
          },
          agentProfileId: {
            type: 'string',
            enum: availableAgentProfileIds,
            description: `Child authority profile. Omit for read-only ${this.defaultAgentProfileId}; select builtin:code only when the task requires actions.`,
          },
        },
        required: ['task'],
      },
      execute: async (raw, context) => await this.delegateTask(raw, {
        signal: context?.signal,
        parentDepth: 0,
      }),
    };
  }

  /**
   * Executes the same policy path used by the model-visible tool. A reservation
   * is registered synchronously before the first awaited operation.
   */
  async delegateTask(
    raw: unknown,
    context: DelegateTaskExecutionContext = {},
  ): Promise<ToolResult> {
    const request = DelegationPolicyService.resolveRequest({
      raw,
      policy: this.policy,
      parentDepth: context.parentDepth ?? 0,
      reservedChildren: this.childRecords.length,
      cancelled: this.scopeController.signal.aborted || context.signal?.aborted === true,
    });
    if (!request.ok) {
      return this.rejection(request.code);
    }

    const agentProfileId = request.input.agentProfileId ?? this.defaultAgentProfileId;
    const snapshot = this.agentSnapshots.get(agentProfileId);
    if (!snapshot) {
      return this.rejection('agent_not_allowed');
    }

    const reserved = this.reserveChild({
      task: request.input.task,
      agentProfileId,
      snapshot,
    });
    const settlement = this.executeReservedChild(reserved, context.signal);
    this.childSettlements.add(settlement);
    try {
      return await settlement;
    } finally {
      this.childSettlements.delete(settlement);
    }
  }

  records(): DelegatedRunRecord[] {
    return cloneDeep(this.childRecords);
  }

  snapshot(): DelegationRootScopeSnapshot {
    return {
      schemaVersion: 1,
      rootRunId: this.rootRunId,
      policy: cloneDeep(this.policy),
      records: this.records(),
    };
  }

  /**
   * Returns the durable parent-turn view only after every reserved child has
   * reached a terminal record. A running child is an ownership invariant
   * violation at the completed-turn persistence boundary.
   */
  settledSnapshot(): SettledDelegationRootScopeSnapshot {
    const records = this.records();
    if (!records.every(isSettledDelegatedRunRecord)) {
      const running = records.find((record) => record.status === 'running');
      throw new Error(
        `Cannot persist delegation while child run is still running: ${running?.childRunId ?? 'unknown'}`,
      );
    }

    return {
      schemaVersion: 1,
      rootRunId: this.rootRunId,
      policy: cloneDeep(this.policy),
      records,
    };
  }

  cancel(reason?: unknown): void {
    if (!this.scopeController.signal.aborted) {
      this.scopeController.abort(reason);
    }
    this.childControllers.forEach((controller) => {
      if (!controller.signal.aborted) {
        controller.abort(reason);
      }
    });
  }

  /**
   * Cancels this scope and waits for every reserved child to reach a settled
   * record so a host never detaches delegated work from its owning root turn.
   */
  async cancelAndWait(reason?: unknown): Promise<void> {
    this.cancel(reason);
    await Promise.allSettled([...this.childSettlements]);
  }

  private resolveAgentSnapshots(
    resolver: DelegationAgentSnapshotResolver,
  ): ReadonlyMap<DelegationAgentProfileId, CustomAgentExecutionSnapshot> {
    return new Map(this.policy.allowedAgentProfileIds.flatMap((agentProfileId) => {
      const snapshot = resolver.resolveExecutionSnapshot(agentProfileId);
      if (!snapshot) {
        throw new Error(`Delegation agent profile could not be resolved: ${agentProfileId}`);
      }
      return this.childRuntime.preflightSnapshot(agentProfileId, snapshot)
        ? [[agentProfileId, cloneDeep(snapshot)] as const]
        : [];
    }));
  }

  private reserveChild(input: {
    task: string;
    agentProfileId: DelegationAgentProfileId;
    snapshot: CustomAgentExecutionSnapshot;
  }): ReservedChild {
    const delegationId = `delegation_${randomUUID()}`;
    const childRunId = this.nextChildRunId();
    const controller = new AbortController();
    const record: DelegatedRunRecord = {
      schemaVersion: 1,
      delegationId,
      rootRunId: this.rootRunId,
      parentRunId: this.rootRunId,
      childRunId,
      depth: 1,
      task: input.task,
      agentSnapshot: cloneDeep(input.snapshot),
      status: 'running',
      startedAt: new Date().toISOString(),
      trace: [],
    };

    this.childRecords.push(record);
    this.childControllers.set(childRunId, controller);
    this.onActivity?.({
      source: 'delegation',
      type: HeddleEventType.delegationStarted,
      ...this.correlation(record),
      task: record.task,
      agentProfileId: record.agentSnapshot.agentProfileId,
      timestamp: record.startedAt,
    });
    return { record, controller, snapshot: cloneDeep(input.snapshot) };
  }

  private nextChildRunId(): string {
    const usedRunIds = new Set([
      this.rootRunId,
      ...this.childRecords.map((record) => record.childRunId),
    ]);
    let runId = AgentLoopCheckpointService.generateRunId();
    while (usedRunIds.has(runId)) {
      runId = AgentLoopCheckpointService.generateRunId();
    }
    return runId;
  }

  private async executeReservedChild(
    reserved: ReservedChild,
    parentSignal: AbortSignal | undefined,
  ): Promise<ToolResult> {
    const ownershipSignal = AbortSignal.any([
      this.scopeController.signal,
      reserved.controller.signal,
      ...(parentSignal ? [parentSignal] : []),
    ]);

    try {
      const runWithinGlobalLimit = async () => await this.semaphore.runExclusive(
        async () => await this.runReservedChild(reserved, ownershipSignal),
      );
      return DelegationChildRuntimeService.isActionProfile(
        reserved.snapshot.agentProfileId as DelegationAgentProfileId,
      )
        ? await this.actionSemaphore.runExclusive(runWithinGlobalLimit)
        : await runWithinGlobalLimit();
    } finally {
      this.childControllers.delete(reserved.record.childRunId);
    }
  }

  private async runReservedChild(
    reserved: ReservedChild,
    ownershipSignal: AbortSignal,
  ): Promise<ToolResult> {
    if (ownershipSignal.aborted) {
      return this.settleWithoutResult(reserved.record, 'cancelled');
    }

    const deadlineController = new AbortController();
    const deadline = setTimeout(() => {
      const error = new Error(DelegationPolicyService.message('child_timeout'));
      error.name = 'TimeoutError';
      deadlineController.abort(error);
    }, this.policy.maxChildDurationMs);
    const signal = AbortSignal.any([
      ownershipSignal,
      deadlineController.signal,
    ]);

    try {
      const result = await this.childRuntime.run({
        record: reserved.record,
        snapshot: reserved.snapshot,
        signal,
        onActivity: (activity) => this.publishChildActivity(reserved.record, activity),
      });
      return this.settleResult(
        reserved.record,
        result,
        deadlineController.signal.aborted && !ownershipSignal.aborted,
      );
    } catch {
      return this.settleWithoutResult(
        reserved.record,
        ownershipSignal.aborted
          ? 'cancelled'
          : deadlineController.signal.aborted ? 'child_timeout' : 'child_failed',
      );
    } finally {
      clearTimeout(deadline);
    }
  }

  private settleResult(
    record: DelegatedRunRecord,
    result: AgentLoopResult,
    timedOut: boolean,
  ): ToolResult {
    const code = timedOut
      ? 'child_timeout'
      : result.outcome === 'done'
        ? undefined
        : result.outcome === 'interrupted' ? 'cancelled' : 'child_failed';
    const cancelled = code === 'cancelled' || code === 'child_timeout';
    Object.assign(record, {
      status: cancelled ? 'cancelled' : 'finished',
      outcome: timedOut ? 'interrupted' : result.outcome,
      summary: timedOut ? DelegationPolicyService.message('child_timeout') : result.summary,
      ...(!timedOut && result.failure ? { failure: result.failure } : {}),
      model: result.model,
      provider: result.provider,
      ...(result.usage ? { usage: result.usage } : {}),
      trace: cloneDeep(result.trace),
      finishedAt: new Date().toISOString(),
    });
    this.publishSettlement(record, code);

    return this.resultForRecord(record, code);
  }

  private settleWithoutResult(
    record: DelegatedRunRecord,
    code: 'cancelled' | 'child_timeout' | 'child_failed',
  ): ToolResult {
    const cancelled = code === 'cancelled' || code === 'child_timeout';
    Object.assign(record, {
      status: cancelled ? 'cancelled' : 'finished',
      outcome: cancelled ? 'interrupted' : 'error',
      summary: DelegationPolicyService.message(code),
      finishedAt: new Date().toISOString(),
    });
    this.publishSettlement(record, code);
    return this.resultForRecord(record, code);
  }

  private resultForRecord(
    record: DelegatedRunRecord,
    code: 'cancelled' | 'child_timeout' | 'child_failed' | undefined,
  ): ToolResult {
    const cancelled = code === 'cancelled' || code === 'child_timeout';
    const output: DelegateTaskOutput = {
      schemaVersion: 1,
      status: cancelled ? 'cancelled' : 'finished',
      delegationId: record.delegationId,
      childRunId: record.childRunId,
      agentProfileId: record.agentSnapshot.agentProfileId as DelegationAgentProfileId,
      outcome: record.outcome,
      summary: record.summary
        ? truncate(record.summary, {
          length: MAX_DELEGATED_SUMMARY_LENGTH,
          omission: '...',
        })
        : undefined,
      failure: record.failure,
      ...(code ? {
        error: {
          code,
          message: DelegationPolicyService.message(code),
        },
      } : {}),
    };

    return code
      ? { ok: false, error: output.error?.message, output }
      : { ok: true, output };
  }

  private rejection(code: DelegationRejectionCode): ToolResult {
    const message = DelegationPolicyService.message(code);
    this.onActivity?.({
      source: 'delegation',
      type: HeddleEventType.delegationRejected,
      rootRunId: this.rootRunId,
      error: { code, message },
      timestamp: new Date().toISOString(),
    });
    const output: DelegateTaskOutput = {
      schemaVersion: 1,
      status: code === 'cancelled' ? 'cancelled' : 'rejected',
      error: { code, message },
    };
    return { ok: false, error: message, output };
  }

  private publishChildActivity(
    record: DelegatedRunRecord,
    activity: ConversationAgentLoopActivity,
  ): void {
    this.onActivity?.({
      source: 'delegation',
      type: HeddleEventType.delegationChildActivity,
      ...this.correlation(record),
      task: record.task,
      agentProfileId: record.agentSnapshot.agentProfileId,
      activity: cloneDeep(activity),
      timestamp: activity.timestamp,
    });
  }

  private publishSettlement(
    record: DelegatedRunRecord,
    code: 'cancelled' | 'child_timeout' | 'child_failed' | undefined,
  ): void {
    const base = {
      source: 'delegation' as const,
      ...this.correlation(record),
      task: record.task,
      agentProfileId: record.agentSnapshot.agentProfileId,
      timestamp: record.finishedAt ?? new Date().toISOString(),
    };
    if (code === 'cancelled' || code === 'child_timeout') {
      this.onActivity?.({
        ...base,
        type: HeddleEventType.delegationCancelled,
        outcome: 'interrupted',
        ...(record.summary ? { summary: record.summary } : {}),
        error: {
          code,
          message: DelegationPolicyService.message(code),
        },
      });
      return;
    }

    this.onActivity?.({
      ...base,
      type: HeddleEventType.delegationFinished,
      outcome: record.outcome ?? 'error',
      ...(record.summary ? { summary: record.summary } : {}),
      ...(record.failure ? { failure: record.failure } : {}),
      ...(record.usage ? { usage: record.usage } : {}),
    });
  }

  private correlation(record: DelegatedRunRecord): ConversationDelegationCorrelation {
    return {
      rootRunId: record.rootRunId,
      parentRunId: record.parentRunId,
      delegationId: record.delegationId,
      childRunId: record.childRunId,
      depth: record.depth,
    };
  }
}

function isSettledDelegatedRunRecord(
  record: DelegatedRunRecord,
): record is SettledDelegatedRunRecord {
  return record.status !== 'running'
    && record.outcome !== undefined
    && record.summary !== undefined
    && record.finishedAt !== undefined;
}
