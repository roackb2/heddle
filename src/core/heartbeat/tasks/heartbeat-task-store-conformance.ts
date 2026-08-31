/**
 * Runner-neutral contract tests for `HeartbeatTaskStore` adapters.
 *
 * Hosts provide fresh store instances bound to one opaque namespace. The suite
 * intentionally uses no test-runner APIs, so a remote adapter can execute it
 * in the same integration environment as its database or lease service.
 */
import { randomUUID } from 'node:crypto';
import type { AgentLoopCheckpoint, AgentLoopState } from '@/core/runtime/loop/index.js';
import type { AgentHeartbeatResult } from '../agent/index.js';
import type {
  HeartbeatAdmissionTarget,
  HeartbeatTask,
  HeartbeatTaskAdmissionControl,
  HeartbeatTaskExecution,
  HeartbeatTargetedTaskStore,
} from './types.js';

type MaybePromise<T> = T | Promise<T>;

export type HeartbeatTaskStoreConformanceCapabilities = {
  /** Verify the optional same-process run-request notification hook. */
  runRequestSubscription?: boolean;
  /** Verify optional persisted run-history readback. */
  runHistory?: boolean;
};

export type HeartbeatTaskStoreConformanceHarness = {
  /** Return a fresh store instance using exactly this opaque backend namespace. */
  createStore(namespace: string): MaybePromise<HeartbeatTargetedTaskStore>;
  /** Return the binary admission control port for the same backend namespace. */
  createAdmissionControl(namespace: string): MaybePromise<HeartbeatTaskAdmissionControl>;
  /** Remove every resource created for an opaque backend namespace. */
  cleanupNamespace(namespace: string): MaybePromise<void>;
  /** Return a deterministic base time; the suite derives fixed offsets from it. */
  now(): Date;
  /**
   * Test-fixture hook that makes one claimed execution eligible for the
   * adapter's normal recovery path.
   *
   * A lease-backed adapter should expire or invalidate the lease through its
   * test fixture. A process-local adapter may simulate a prior process by
   * persisting an untracked execution. This is deliberately not part of the
   * production store contract because recovery authority is host-specific.
   */
  makeExecutionRecoverable(input: {
    namespace: string;
    store: HeartbeatTargetedTaskStore;
    task: HeartbeatTask;
    execution: HeartbeatTaskExecution;
    recoverAt: Date;
  }): MaybePromise<void>;
  capabilities?: HeartbeatTaskStoreConformanceCapabilities;
};

export type HeartbeatTaskStoreConformanceScenario = Readonly<{
  name: string;
  run: () => Promise<void>;
}>;

export class HeartbeatTaskStoreConformanceError extends Error {
  constructor(scenario: string, detail: string, options?: ErrorOptions) {
    super(`Heartbeat task store conformance failed (${scenario}): ${detail}`, options);
    this.name = 'HeartbeatTaskStoreConformanceError';
  }
}

type ScenarioOperation = (
  namespace: string,
  harness: HeartbeatTaskStoreConformanceHarness,
) => Promise<void>;

const scenarioName = {
  roundTrip: 'fresh instances share task and checkpoint state while task ids remain independent',
  targeting: 'target lookup and due claims are atomic across competing instances',
  requests: 'run requests coalesce atomically and settlement preserves newer host state',
  settlement: 'success, skip, cancellation, and failure settle atomically',
  recovery: 'competing claims are busy, live work is retained, and stale settlement is fenced after recovery',
  admission: 'namespace and group admission changes linearize with claims while unrelated groups keep progressing',
  subscription: 'optional run-request subscriptions receive cross-instance signals and unsubscribe',
  history: 'optional run history supports save, list, filter, limit, and load',
} as const;

/**
 * Canonical behavioral suite for certifying a custom heartbeat task store.
 * `createScenarios` fits test runners; `runAll` fits host integration scripts.
 */
export class HeartbeatTaskStoreConformance {
  static createScenarios(
    harness: HeartbeatTaskStoreConformanceHarness,
  ): HeartbeatTaskStoreConformanceScenario[] {
    const scenarios = [
      HeartbeatTaskStoreConformance.createScenario(scenarioName.roundTrip, harness, HeartbeatTaskStoreConformance.verifyRoundTrip),
      HeartbeatTaskStoreConformance.createScenario(scenarioName.targeting, harness, HeartbeatTaskStoreConformance.verifyTargetedClaims),
      HeartbeatTaskStoreConformance.createScenario(scenarioName.requests, harness, HeartbeatTaskStoreConformance.verifyRunRequests),
      HeartbeatTaskStoreConformance.createScenario(scenarioName.settlement, harness, HeartbeatTaskStoreConformance.verifySettlements),
      HeartbeatTaskStoreConformance.createScenario(scenarioName.recovery, harness, HeartbeatTaskStoreConformance.verifyRecoveryAndFencing),
      HeartbeatTaskStoreConformance.createScenario(scenarioName.admission, harness, HeartbeatTaskStoreConformance.verifyAdmission),
    ];
    if (harness.capabilities?.runRequestSubscription) {
      scenarios.push(HeartbeatTaskStoreConformance.createScenario(
        scenarioName.subscription,
        harness,
        HeartbeatTaskStoreConformance.verifyRunRequestSubscription,
      ));
    }
    if (harness.capabilities?.runHistory) {
      scenarios.push(HeartbeatTaskStoreConformance.createScenario(
        scenarioName.history,
        harness,
        HeartbeatTaskStoreConformance.verifyRunHistory,
      ));
    }
    return scenarios;
  }

  static async runAll(harness: HeartbeatTaskStoreConformanceHarness): Promise<void> {
    for (const scenario of HeartbeatTaskStoreConformance.createScenarios(harness)) {
      await scenario.run();
    }
  }

  private static createScenario(
    name: string,
    harness: HeartbeatTaskStoreConformanceHarness,
    operation: ScenarioOperation,
  ): HeartbeatTaskStoreConformanceScenario {
    return {
      name,
      run: async () => {
        const namespace = randomUUID();
        await HeartbeatTaskStoreConformance.runWithCleanup(name, namespace, harness, operation);
      },
    };
  }

  private static async runWithCleanup(
    scenario: string,
    namespace: string,
    harness: HeartbeatTaskStoreConformanceHarness,
    operation: ScenarioOperation,
  ): Promise<void> {
    let operationError: unknown;
    try {
      await operation(namespace, harness);
    } catch (error) {
      operationError = error;
    }
    let cleanupError: unknown;
    try {
      await harness.cleanupNamespace(namespace);
    } catch (error) {
      cleanupError = error;
    }
    if (operationError && cleanupError) {
      throw new HeartbeatTaskStoreConformanceError(scenario, 'the scenario and namespace cleanup both failed', {
        cause: new AggregateError([operationError, cleanupError]),
      });
    }
    if (operationError instanceof HeartbeatTaskStoreConformanceError) throw operationError;
    if (operationError) {
      throw new HeartbeatTaskStoreConformanceError(scenario, 'the adapter operation failed unexpectedly', { cause: operationError });
    }
    if (cleanupError) {
      throw new HeartbeatTaskStoreConformanceError(scenario, 'namespace cleanup failed', { cause: cleanupError });
    }
  }

  private static async verifyRoundTrip(namespace: string, harness: HeartbeatTaskStoreConformanceHarness): Promise<void> {
    const first = await harness.createStore(namespace);
    const second = await harness.createStore(namespace);
    const alpha = createTask('alpha');
    const beta = createTask('beta');
    await first.saveTask(alpha);
    await first.saveTask(beta);
    const checkpoint = createResult('checkpoint').checkpoint;
    await first.saveCheckpoint(alpha, checkpoint);
    await first.saveTask(alpha);
    await first.saveCheckpoint(alpha, checkpoint);

    const loadedCheckpoint = await second.loadCheckpoint(alpha);
    assert(loadedCheckpoint?.runId === checkpoint.runId, 'a fresh instance must read the saved checkpoint run id');
    assert(loadedCheckpoint?.state.summary === checkpoint.state.summary, 'a fresh instance must read the saved checkpoint state');
    assert((await second.loadTask(alpha.id))?.id === alpha.id, 'a fresh instance must directly load task alpha');
    assert((await second.loadTask(beta.id))?.id === beta.id, 'a fresh instance must directly load task beta');
    await second.requestTaskRun(beta.id, { requestedAt: at(harness, 1_000), reason: 'beta-work' });
    const persistedAlpha = await requireTask(first, alpha.id);
    const persistedBeta = await requireTask(first, beta.id);
    assert(persistedAlpha.state?.runRequest === undefined, 'a request for beta must not mutate alpha');
    assert(persistedBeta.state?.runRequest?.generation === 1, 'beta must retain its own request generation');
  }

  private static async verifyTargetedClaims(namespace: string, harness: HeartbeatTaskStoreConformanceHarness): Promise<void> {
    const first = await harness.createStore(namespace);
    const second = await harness.createStore(namespace);
    const future = {
      ...createTask('future'),
      schedule: { intervalMs: 60_000, nextRunAt: at(harness, 60_000).toISOString() },
    } satisfies HeartbeatTask;
    const target = createTask('target');
    await first.saveTask(future);
    await first.saveTask(target);

    const notDue = await second.claimTaskExecution({
      taskId: future.id,
      execution: createExecution('future-execution', 'owner-a', harness),
      loadedCheckpoint: false,
      claimedAt: at(harness, 0),
      claimMode: 'due',
    });
    assert(notDue.status === 'not-due', 'a due claim must reject a future task atomically');

    const firstExecution = createExecution('target-first', 'owner-a', harness);
    const secondExecution = createExecution('target-second', 'owner-b', harness);
    const claims = await Promise.all([
      first.claimTaskExecution({
        taskId: target.id,
        execution: firstExecution,
        loadedCheckpoint: false,
        claimedAt: at(harness, 1_000),
        claimMode: 'due',
      }),
      second.claimTaskExecution({
        taskId: target.id,
        execution: secondExecution,
        loadedCheckpoint: false,
        claimedAt: at(harness, 1_000),
        claimMode: 'due',
      }),
    ]);
    assert(claims.filter((claim) => claim.status === 'claimed').length === 1, 'exactly one competing due claim must win');
    assert(claims.filter((claim) => claim.status === 'busy').length === 1, 'the losing due claim must observe busy');

    const winningExecution = claims[0]?.status === 'claimed' ? firstExecution : secondExecution;
    const settled = await first.recordTaskExecutionOutcome({
      taskId: target.id,
      execution: winningExecution,
      kind: 'skipped',
      summary: 'Targeted work settled.',
      finishedAt: at(harness, 2_000),
    });
    assert(settled.status === 'saved', 'the winning targeted claim must settle');

    const duplicate = await second.claimTaskExecution({
      taskId: target.id,
      execution: createExecution('target-duplicate', 'owner-c', harness),
      loadedCheckpoint: false,
      claimedAt: at(harness, 3_000),
      claimMode: 'due',
    });
    assert(duplicate.status === 'not-due', 'a duplicate delivery after settlement must not rerun the task');
    const untouchedFuture = await first.loadTask(future.id);
    assert(
      untouchedFuture?.state?.execution === undefined && untouchedFuture?.state?.lastExecution === undefined,
      'targeted execution must not claim or settle an unrelated task',
    );
  }

  private static async verifyRunRequests(namespace: string, harness: HeartbeatTaskStoreConformanceHarness): Promise<void> {
    const first = await harness.createStore(namespace);
    const second = await harness.createStore(namespace);
    const task = createTask('requests');
    await first.saveTask(task);
    const requests = await Promise.all([
      first.requestTaskRun(task.id, { requestedAt: at(harness, 1_000), reason: 'first' }),
      second.requestTaskRun(task.id, { requestedAt: at(harness, 2_000), reason: 'second' }),
    ]);
    assert(requests.filter((request) => request.disposition === 'requested').length === 1, 'exactly one concurrent request must become pending');
    assert(requests.filter((request) => request.disposition === 'coalesced').length === 1, 'the second concurrent request must coalesce');
    const execution = createExecution('request-execution', 'owner-a', harness);
    const claimed = await first.claimTaskExecution({ taskId: task.id, execution, loadedCheckpoint: false, claimedAt: at(harness, 3_000) });
    assert(claimed.status === 'claimed', 'the requested task must be claimable');
    const current = await requireTask(second, task.id);
    await second.saveTask({ ...current, name: 'Operator changed this while it ran' });
    await second.requestTaskRun(task.id, { requestedAt: at(harness, 4_000), reason: 'after-claim' });
    const settled = await first.recordTaskExecutionOutcome({
      taskId: task.id,
      execution,
      kind: 'skipped',
      summary: 'No work remained after the claim.',
      finishedAt: at(harness, 5_000),
    });
    assert(settled.status === 'saved', 'a current skip must settle');
    const persisted = await requireTask(first, task.id);
    assert(persisted.name === 'Operator changed this while it ran', 'settlement must preserve a newer operator update');
    assert(persisted.state?.runRequest?.generation === 3, 'a request after claim must remain durable');
    assert(persisted.state?.runRequest?.claimedGeneration === 2, 'settlement must not consume a post-claim request');
  }

  private static async verifySettlements(namespace: string, harness: HeartbeatTaskStoreConformanceHarness): Promise<void> {
    const store = await harness.createStore(namespace);
    const tasks = ['success', 'skip', 'cancel', 'failure'].map(createTask);
    await Promise.all(tasks.map(async (task) => await store.saveTask(task)));

    const successExecution = createExecution('success-execution', 'owner-a', harness);
    await assertClaimed(store, 'success', successExecution, harness, 1_000);
    const success = await store.completeTaskExecution({
      taskId: 'success', execution: successExecution, checkpoint: createResult('success').checkpoint,
      result: createResult('success'), loadedCheckpoint: false, completedAt: at(harness, 2_000),
    });
    assert(success.status === 'saved' && success.record?.outcome?.kind === 'agent', 'success must atomically return its durable run record');
    const persistedSuccess = await requireTask(store, 'success');
    const persistedCheckpoint = await store.loadCheckpoint(persistedSuccess);
    assert(persistedSuccess.state?.lastExecution?.kind === 'agent', 'success must durably settle the task state');
    assert(persistedCheckpoint?.runId === 'success', 'success must durably persist its checkpoint');
    if (harness.capabilities?.runHistory) {
      assert(store.listRunRecords, 'runHistory requires listRunRecords');
      const records = await store.listRunRecords({ taskId: 'success' });
      assert(records.some((entry) => entry.executionId === successExecution.executionId), 'success must durably persist its run record');
    }
    const repeatedSuccess = await store.completeTaskExecution({
      taskId: 'success', execution: successExecution, checkpoint: createResult('success').checkpoint,
      result: createResult('success'), loadedCheckpoint: false, completedAt: at(harness, 2_000),
    });
    assert(repeatedSuccess.status === 'claim-lost', 'repeating a settled execution must not duplicate or overwrite it');

    const skipExecution = createExecution('skip-execution', 'owner-a', harness);
    await assertClaimed(store, 'skip', skipExecution, harness, 3_000);
    const skipped = await store.recordTaskExecutionOutcome({ taskId: 'skip', execution: skipExecution, kind: 'skipped', summary: 'No work.', finishedAt: at(harness, 4_000) });
    assert(skipped.status === 'saved' && skipped.record?.outcome?.kind === 'skipped', 'skip must atomically return its durable run record');

    const cancelledExecution = createExecution('cancel-execution', 'owner-a', harness);
    await assertClaimed(store, 'cancel', cancelledExecution, harness, 5_000);
    const cancelled = await store.recordTaskExecutionOutcome({ taskId: 'cancel', execution: cancelledExecution, kind: 'cancelled', summary: 'Stopped.', reason: 'operator-request', finishedAt: at(harness, 6_000) });
    assert(cancelled.status === 'saved' && cancelled.record?.outcome?.kind === 'cancelled', 'cancellation must atomically return its durable run record');

    const failureExecution = createExecution('failure-execution', 'owner-a', harness);
    await assertClaimed(store, 'failure', failureExecution, harness, 7_000);
    const failed = await store.failTaskExecution({ taskId: 'failure', execution: failureExecution, error: new Error('temporary failure'), failedAt: at(harness, 8_000), retryMs: 60_000 });
    assert(failed.status === 'saved' && failed.task.state?.lastExecution?.kind === 'failed', 'failure must settle only the current claim');
  }

  private static async verifyRecoveryAndFencing(namespace: string, harness: HeartbeatTaskStoreConformanceHarness): Promise<void> {
    const first = await harness.createStore(namespace);
    const second = await harness.createStore(namespace);
    const task = createTask('recovery');
    await first.saveTask(task);
    const live = createExecution('live-execution', 'live-owner', harness);
    await assertClaimed(first, task.id, live, harness, 1_000);
    const competing = await second.claimTaskExecution({ taskId: task.id, execution: createExecution('competing', 'owner-b', harness), loadedCheckpoint: false, claimedAt: at(harness, 2_000) });
    assert(competing.status === 'busy', 'a second instance must not claim active work');
    const liveRecovery = await second.recoverInterruptedTasks({ ownerId: 'other-owner', recoveredAt: at(harness, 3_000), reason: 'host-restart' });
    assert(liveRecovery.length === 0, 'a live in-process execution must not be recovered');

    const expired = createExecution('expired-execution', 'expired-owner', harness);
    await harness.makeExecutionRecoverable({
      namespace,
      store: first,
      task: await requireTask(first, task.id),
      execution: expired,
      recoverAt: at(harness, 4_000),
    });
    const recovered = await second.recoverInterruptedTasks({ ownerId: 'replacement-owner', recoveredAt: at(harness, 4_000), reason: 'host-restart' });
    assert(recovered.length === 1 && recovered[0]?.recovery.interruptedExecutionId === expired.executionId, 'an untracked prior owner must recover once');
    const repeatedRecovery = await first.recoverInterruptedTasks({ ownerId: 'replacement-owner', recoveredAt: at(harness, 5_000), reason: 'host-restart' });
    assert(repeatedRecovery.length === 0, 'recovery must be idempotent');
    const replacement = createExecution('replacement-execution', 'replacement-owner', harness);
    await assertClaimed(second, task.id, replacement, harness, 6_000);
    const staleResult = createResult('late-success');
    const staleWrites = await Promise.all([
      first.completeTaskExecution({
        taskId: task.id,
        execution: expired,
        checkpoint: staleResult.checkpoint,
        result: staleResult,
        loadedCheckpoint: false,
        completedAt: at(harness, 7_000),
      }),
      first.failTaskExecution({
        taskId: task.id,
        execution: expired,
        error: new Error('Late failure.'),
        failedAt: at(harness, 7_000),
        retryMs: 60_000,
      }),
      first.recordTaskExecutionOutcome({
        taskId: task.id,
        execution: expired,
        kind: 'cancelled',
        summary: 'Late cancellation.',
        finishedAt: at(harness, 7_000),
      }),
    ]);
    assert(staleWrites.every((write) => write.status === 'claim-lost'), 'every stale settlement path must reject the superseded execution');
    const current = await requireTask(second, task.id);
    assert(current.state?.execution?.executionId === replacement.executionId, 'a stale write must not replace the newer claim');
  }

  private static async verifyAdmission(namespace: string, harness: HeartbeatTaskStoreConformanceHarness): Promise<void> {
    const first = await harness.createStore(namespace);
    const second = await harness.createStore(namespace);
    const admission = await harness.createAdmissionControl(namespace);
    const namespaceTarget = { kind: 'namespace' } as const;
    const groupA = { kind: 'group', groupId: 'publisher-a' } as const;
    const groupB = { kind: 'group', groupId: 'publisher-b' } as const;

    assert(
      await admission.readAdmissionDecision(namespaceTarget) === 'ready',
      'an absent namespace decision must preserve legacy readiness',
    );
    assert(
      await admission.readAdmissionDecision(groupA) === 'closed',
      'an absent assigned group must fail closed',
    );

    const legacy = createTask('admission-legacy');
    const groupedWhileMissing = createGroupedTask('admission-missing', groupA);
    const checkpoint = createResult('admission-checkpoint').checkpoint;
    await first.saveTask(legacy);
    await first.saveTask(groupedWhileMissing);
    await first.saveCheckpoint(groupedWhileMissing, checkpoint);

    const missingGroupClaim = await first.claimTaskExecution({
      taskId: groupedWhileMissing.id,
      execution: createExecution('missing-group-execution', 'owner-a', harness),
      loadedCheckpoint: true,
      claimedAt: at(harness, 1_000),
      claimMode: 'due',
    });
    assertAdmissionClosed(missingGroupClaim, groupA, 'a task cannot claim before its assigned group is initialized');
    const preserved = await requireTask(second, groupedWhileMissing.id);
    assert(preserved.enabled, 'closing admission must not disable the task');
    assert(
      preserved.schedule.nextRunAt === groupedWhileMissing.schedule.nextRunAt,
      'closing admission must preserve the due schedule',
    );
    assert(
      (await second.loadCheckpoint(preserved))?.runId === checkpoint.runId,
      'closing admission must preserve the checkpoint',
    );

    const legacyExecution = createExecution('legacy-execution', 'owner-a', harness);
    await assertClaimed(first, legacy.id, legacyExecution, harness, 2_000);
    const legacySettlement = await first.recordTaskExecutionOutcome({
      taskId: legacy.id,
      execution: legacyExecution,
      kind: 'skipped',
      summary: 'Legacy namespace-only work settled.',
      finishedAt: at(harness, 3_000),
    });
    assert(legacySettlement.status === 'saved', 'an ungrouped legacy task must retain namespace-only behavior');

    await admission.setAdmissionDecision(groupA, 'ready');
    await admission.setAdmissionDecision(groupB, 'ready');
    const namespaceBlocked = createGroupedTask('namespace-blocked', groupB);
    await first.saveTask(namespaceBlocked);
    await admission.setAdmissionDecision(namespaceTarget, 'closed');
    const namespaceClaim = await second.claimTaskExecution({
      taskId: namespaceBlocked.id,
      execution: createExecution('namespace-closed-execution', 'owner-b', harness),
      loadedCheckpoint: false,
      claimedAt: at(harness, 4_000),
      claimMode: 'due',
    });
    assertAdmissionClosed(namespaceClaim, namespaceTarget, 'namespace admission must override a ready group');
    await admission.setAdmissionDecision(namespaceTarget, 'ready');

    const alreadyClaimed = createGroupedTask('admission-active', groupA);
    await first.saveTask(alreadyClaimed);
    const activeExecution = createExecution('admission-active-execution', 'owner-a', harness);
    await assertClaimed(first, alreadyClaimed.id, activeExecution, harness, 5_000);
    await admission.setAdmissionDecision(groupA, 'closed');
    const activeSettlement = await first.recordTaskExecutionOutcome({
      taskId: alreadyClaimed.id,
      execution: activeExecution,
      kind: 'skipped',
      summary: 'Already claimed work remained owned after admission closed.',
      finishedAt: at(harness, 6_000),
    });
    assert(activeSettlement.status === 'saved', 'closing admission must not cancel an already claimed execution');

    await admission.setAdmissionDecision(groupA, 'ready');
    const racing = createGroupedTask('admission-race', groupA);
    await first.saveTask(racing);
    const raceExecution = createExecution('admission-race-execution', 'owner-a', harness);
    const [, raceClaim] = await Promise.all([
      admission.setAdmissionDecision(groupA, 'closed'),
      second.claimTaskExecution({
        taskId: racing.id,
        execution: raceExecution,
        loadedCheckpoint: false,
        claimedAt: at(harness, 7_000),
        claimMode: 'due',
      }),
    ]);
    assert(
      raceClaim.status === 'claimed' || raceClaim.status === 'admission-closed',
      'a close-vs-claim race must linearize as either a claim or a closed decision',
    );
    assert(
      await admission.readAdmissionDecision(groupA) === 'closed',
      'the completed close must remain durable after the race',
    );
    if (raceClaim.status === 'claimed') {
      const settlement = await first.recordTaskExecutionOutcome({
        taskId: racing.id,
        execution: raceExecution,
        kind: 'skipped',
        summary: 'The claim linearized before admission closed.',
        finishedAt: at(harness, 8_000),
      });
      assert(settlement.status === 'saved', 'closing admission must not cancel an already claimed execution');
    } else {
      assertDeepEqual(raceClaim.target, groupA, 'the racing claim must identify the blocking group');
    }

    const groupBTask = createGroupedTask('admission-unrelated', groupB);
    await first.saveTask(groupBTask);
    const groupBExecution = createExecution('group-b-execution', 'owner-b', harness);
    await assertClaimed(second, groupBTask.id, groupBExecution, harness, 9_000);
    const groupBSettlement = await second.recordTaskExecutionOutcome({
      taskId: groupBTask.id,
      execution: groupBExecution,
      kind: 'skipped',
      summary: 'The unrelated group remained ready.',
      finishedAt: at(harness, 10_000),
    });
    assert(groupBSettlement.status === 'saved', 'closing one group must not block unrelated-group progress');
  }

  private static async verifyRunRequestSubscription(namespace: string, harness: HeartbeatTaskStoreConformanceHarness): Promise<void> {
    const first = await harness.createStore(namespace);
    const second = await harness.createStore(namespace);
    const task = createTask('subscription');
    await first.saveTask(task);
    assert(first.subscribeToRunRequests, 'runRequestSubscription requires subscribeToRunRequests');
    const signals: string[] = [];
    const unsubscribe = first.subscribeToRunRequests((signal) => signals.push(signal.taskId));
    await second.requestTaskRun(task.id, { requestedAt: at(harness, 1_000), reason: 'wake' });
    assertDeepEqual(signals, [task.id], 'a second instance request must notify the first instance subscriber');
    unsubscribe();
    await second.requestTaskRun(task.id, { requestedAt: at(harness, 2_000), reason: 'after-unsubscribe' });
    assertDeepEqual(signals, [task.id], 'unsubscribe must stop notification delivery');
  }

  private static async verifyRunHistory(namespace: string, harness: HeartbeatTaskStoreConformanceHarness): Promise<void> {
    const store = await harness.createStore(namespace);
    assert(store.saveRunRecord && store.listRunRecords && store.loadRunRecord, 'runHistory requires saveRunRecord, listRunRecords, and loadRunRecord');
    const firstRecord = createRunRecord('history-a', 'history-a-execution', harness);
    const secondRecord = createRunRecord('history-b', 'history-b-execution', harness);
    await store.saveRunRecord(firstRecord);
    await store.saveRunRecord(secondRecord);
    const filtered = await store.listRunRecords({ taskId: 'history-a', limit: 1 });
    assert(filtered.length === 1 && filtered[0]?.taskId === 'history-a', 'history filtering and limits must apply');
    const all = await store.listRunRecords();
    const persisted = all.find((entry) => entry.taskId === 'history-a');
    assert(persisted, 'saved history must be listed');
    assertDeepEqual(await store.loadRunRecord(persisted.id), persisted, 'listed history must load by id');
  }
}

function createTask(id: string): HeartbeatTask {
  return { id, task: `Process ${id}.`, enabled: true, schedule: { intervalMs: 60_000, nextRunAt: '2000-01-01T00:00:00.000Z' } };
}

function createGroupedTask(id: string, target: Extract<HeartbeatAdmissionTarget, { kind: 'group' }>): HeartbeatTask {
  return { ...createTask(id), admissionGroupId: target.groupId };
}

function createExecution(executionId: string, ownerId: string, harness: HeartbeatTaskStoreConformanceHarness): HeartbeatTaskExecution {
  return { executionId, ownerId, claimedAt: at(harness, 0).toISOString() };
}

function createResult(runId: string): AgentHeartbeatResult {
  const state: AgentLoopState = {
    status: 'finished', runId, goal: 'Conformance result.', model: 'gpt-test', provider: 'openai', workspaceRoot: '/tmp/conformance',
    startedAt: '2026-01-01T00:00:00.000Z', finishedAt: '2026-01-01T00:00:01.000Z', outcome: 'done', summary: `Result ${runId}.`, transcript: [], trace: [],
  };
  const checkpoint: AgentLoopCheckpoint = { version: 1, runId, createdAt: state.finishedAt, state };
  return { decision: 'continue', summary: state.summary, state, checkpoint };
}

function createRunRecord(taskId: string, executionId: string, harness: HeartbeatTaskStoreConformanceHarness) {
  const task = createTask(taskId);
  return { task, outcome: { kind: 'skipped' as const, executionId, summary: 'No work.', finishedAt: at(harness, 1_000).toISOString() } };
}

async function assertClaimed(store: HeartbeatTargetedTaskStore, taskId: string, execution: HeartbeatTaskExecution, harness: HeartbeatTaskStoreConformanceHarness, offsetMs: number): Promise<void> {
  const result = await store.claimTaskExecution({ taskId, execution, loadedCheckpoint: false, claimedAt: at(harness, offsetMs) });
  assert(result.status === 'claimed', `expected ${taskId} to be claimed, received ${result.status}`);
}

async function requireTask(store: HeartbeatTargetedTaskStore, taskId: string): Promise<HeartbeatTask> {
  const task = await store.loadTask(taskId);
  if (!task) throw new Error(`Expected task ${taskId} to exist.`);
  return task;
}

function at(harness: HeartbeatTaskStoreConformanceHarness, offsetMs: number): Date {
  return new Date(harness.now().getTime() + offsetMs);
}

function assert(condition: unknown, detail: string): asserts condition {
  if (!condition) throw new Error(detail);
}

function assertDeepEqual(actual: unknown, expected: unknown, detail: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(detail);
}

function assertAdmissionClosed(
  claim: Awaited<ReturnType<HeartbeatTargetedTaskStore['claimTaskExecution']>>,
  target: HeartbeatAdmissionTarget,
  detail: string,
): void {
  assert(claim.status === 'admission-closed', detail);
  assertDeepEqual(claim.target, target, `${detail}; the result must identify the blocking target`);
}
