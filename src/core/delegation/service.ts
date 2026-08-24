import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { Semaphore } from 'async-mutex';
import cloneDeep from 'lodash/cloneDeep.js';
import truncate from 'lodash/truncate.js';
import {
  CustomAgentService,
} from '@/core/custom-agents/index.js';
import type { CustomAgentExecutionSnapshot } from '@/core/custom-agents/index.js';
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
  private readonly childRuntime: DelegationChildRuntimeService;
  private readonly defaultAgentProfileId: DelegationAgentProfileId;
  private readonly semaphore: Semaphore;
  private readonly scopeController = new AbortController();

  constructor(
    policy: DelegationPolicy,
    options: CreateDelegationRootScopeOptions,
  ) {
    this.policy = DelegationPolicyService.resolve(policy);
    this.rootRunId = AgentLoopCheckpointService.resolveRunId(options.rootRunId);
    this.workspaceRoot = resolve(options.workspaceRoot);
    this.semaphore = new Semaphore(this.policy.maxConcurrentChildren);
    this.defaultAgentProfileId = this.policy.allowedAgentProfileIds.includes('builtin:ask')
      ? 'builtin:ask'
      : this.policy.allowedAgentProfileIds[0]!;
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
  }

  /**
   * Creates the only model-visible delegation entry point for this scope.
   */
  createTool(): ToolDefinition {
    return {
      name: 'delegate_task',
      description: [
        'Run one bounded, read-only child agent on an independent inspection task.',
        'The child receives the same workspace but no parent transcript and cannot delegate or mutate state.',
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
            description: 'Self-contained inspection or review task for the child agent.',
          },
          agentProfileId: {
            type: 'string',
            enum: [...this.policy.allowedAgentProfileIds],
            description: `Read-only child profile. Omit to use ${this.defaultAgentProfileId}.`,
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
    return await this.executeReservedChild(reserved, context.signal);
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

  private resolveAgentSnapshots(
    resolver: DelegationAgentSnapshotResolver,
  ): ReadonlyMap<DelegationAgentProfileId, CustomAgentExecutionSnapshot> {
    return new Map(this.policy.allowedAgentProfileIds.map((agentProfileId) => {
      const snapshot = resolver.resolveExecutionSnapshot(agentProfileId);
      if (!snapshot) {
        throw new Error(`Delegation agent profile could not be resolved: ${agentProfileId}`);
      }
      this.childRuntime.preflightSnapshot(agentProfileId, snapshot);
      return [agentProfileId, cloneDeep(snapshot)];
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
    const signal = AbortSignal.any([
      this.scopeController.signal,
      reserved.controller.signal,
      ...(parentSignal ? [parentSignal] : []),
    ]);

    try {
      return await this.semaphore.runExclusive(async () => {
        if (signal.aborted) {
          return this.settleWithoutResult(reserved.record, 'cancelled');
        }

        try {
          const result = await this.childRuntime.run({
            record: reserved.record,
            snapshot: reserved.snapshot,
            signal,
          });
          return this.settleResult(reserved.record, result);
        } catch {
          return this.settleWithoutResult(
            reserved.record,
            signal.aborted ? 'cancelled' : 'child_failed',
          );
        }
      });
    } finally {
      this.childControllers.delete(reserved.record.childRunId);
    }
  }

  private settleResult(
    record: DelegatedRunRecord,
    result: AgentLoopResult,
  ): ToolResult {
    const cancelled = result.outcome === 'interrupted';
    Object.assign(record, {
      status: cancelled ? 'cancelled' : 'finished',
      outcome: result.outcome,
      summary: result.summary,
      ...(result.failure ? { failure: result.failure } : {}),
      model: result.model,
      provider: result.provider,
      ...(result.usage ? { usage: result.usage } : {}),
      trace: cloneDeep(result.trace),
      finishedAt: new Date().toISOString(),
    });

    return this.resultForRecord(
      record,
      result.outcome === 'done'
        ? undefined
        : cancelled ? 'cancelled' : 'child_failed',
    );
  }

  private settleWithoutResult(
    record: DelegatedRunRecord,
    code: 'cancelled' | 'child_failed',
  ): ToolResult {
    Object.assign(record, {
      status: code === 'cancelled' ? 'cancelled' : 'finished',
      outcome: code === 'cancelled' ? 'interrupted' : 'error',
      summary: DelegationPolicyService.message(code),
      finishedAt: new Date().toISOString(),
    });
    return this.resultForRecord(record, code);
  }

  private resultForRecord(
    record: DelegatedRunRecord,
    code: 'cancelled' | 'child_failed' | undefined,
  ): ToolResult {
    const output: DelegateTaskOutput = {
      schemaVersion: 1,
      status: code === 'cancelled' ? 'cancelled' : 'finished',
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
    const output: DelegateTaskOutput = {
      schemaVersion: 1,
      status: code === 'cancelled' ? 'cancelled' : 'rejected',
      error: { code, message },
    };
    return { ok: false, error: message, output };
  }
}
