import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import {
  HostedConversationAcceptedTurnSchema,
  HostedConversationExpiredTurnReconciliationSchema,
  HostedConversationRequestedTurnSchema,
  HostedConversationTurnSettlementSchema,
  type HostedConversationTurnIdentity,
  type HostedConversationTurnLifecycleRecord,
  type HostedConversationTurnLifecycleStore,
} from '../conversation/index.js';

const fixtureUrl = new URL(
  '../../spec/v1/fixtures/durable-conversation-lifecycle.json',
  import.meta.url,
);
const RunningRecordSchema = HostedConversationRequestedTurnSchema.extend({
  status: z.literal('running'),
  runId: HostedConversationAcceptedTurnSchema.shape.runId,
  acceptedAt: HostedConversationAcceptedTurnSchema.shape.acceptedAt,
}).strict();
const CompletedRecordSchema = RunningRecordSchema.extend({
  status: z.literal('completed'),
  summary: z.string(),
  settledAt: HostedConversationTurnSettlementSchema.options[0].shape.settledAt,
}).strict();
const CompletedSettlementSchema = HostedConversationTurnSettlementSchema.options[0];
const FailedSettlementSchema = HostedConversationTurnSettlementSchema.options[2];
const StoreFixtureSchema = z.object({
  storeCases: z.object({
    lifecycleAndFencing: z.object({
      requested: HostedConversationRequestedTurnSchema,
      wrongScopeAccepted: HostedConversationAcceptedTurnSchema,
      accepted: HostedConversationAcceptedTurnSchema,
      conflictingAccepted: HostedConversationAcceptedTurnSchema,
      conflictingAcceptedAt: HostedConversationAcceptedTurnSchema,
      completed: CompletedSettlementSchema,
      wrongScopeCompleted: CompletedSettlementSchema,
      conflictingCompleted: FailedSettlementSchema,
      conflictingSettledAt: CompletedSettlementSchema,
      expectedRunning: RunningRecordSchema,
      expectedCompleted: CompletedRecordSchema,
    }).strict(),
    preAcceptanceFailure: z.object({
      requested: HostedConversationRequestedTurnSchema,
      settlement: FailedSettlementSchema,
    }).strict(),
    expiry: z.object({
      expiredRequested: HostedConversationRequestedTurnSchema,
      expiredRunning: HostedConversationRequestedTurnSchema,
      expiredRunningAcceptance: HostedConversationAcceptedTurnSchema,
      futureRequested: HostedConversationRequestedTurnSchema,
      terminalRequested: HostedConversationRequestedTurnSchema,
      terminalSettlement: FailedSettlementSchema,
      otherScopeExpired: HostedConversationRequestedTurnSchema,
      reconciliation: HostedConversationExpiredTurnReconciliationSchema,
    }).strict(),
  }).strict(),
}).passthrough();

export type HostedConversationTurnStoreConformanceHarness = {
  store: HostedConversationTurnLifecycleStore;
  findTurn(
    identity: HostedConversationTurnIdentity,
  ): Promise<HostedConversationTurnLifecycleRecord | undefined>;
  clear(): Promise<void>;
};

/**
 * Certifies the atomic transition behavior required by the durable turn
 * service using the same published vectors as non-TypeScript implementations.
 */
export class HostedConversationTurnStoreConformance {
  static async verify(
    harness: HostedConversationTurnStoreConformanceHarness,
  ): Promise<void> {
    const fixture = await loadStoreFixture();
    await harness.clear();
    try {
      await this.verifyLifecycleAndFencing(
        harness,
        fixture.lifecycleAndFencing,
      );
      await harness.clear();
      await this.verifyPreAcceptanceFailure(
        harness,
        fixture.preAcceptanceFailure,
      );
      await harness.clear();
      await this.verifyScopedExpiry(harness, fixture.expiry);
    } finally {
      await harness.clear();
    }
  }

  private static async verifyLifecycleAndFencing(
    harness: HostedConversationTurnStoreConformanceHarness,
    fixture: z.infer<typeof StoreFixtureSchema>['storeCases'][
      'lifecycleAndFencing'
    ],
  ): Promise<void> {
    const { store } = harness;
    await store.createTurn(fixture.requested);
    assert.deepEqual(await harness.findTurn(fixture.requested), {
      ...fixture.requested,
      status: 'requested',
    });
    await assert.rejects(() => store.createTurn(fixture.requested));

    await assert.rejects(() => store.recordAccepted(
      fixture.wrongScopeAccepted,
    ));
    await store.recordAccepted(fixture.accepted);
    await store.recordAccepted(fixture.accepted);
    await assert.rejects(() => store.recordAccepted(
      fixture.conflictingAccepted,
    ));
    await assert.rejects(() => store.recordAccepted(
      fixture.conflictingAcceptedAt,
    ));
    assert.deepEqual(
      await harness.findTurn(fixture.requested),
      fixture.expectedRunning,
    );

    await assert.rejects(() => store.settleTurn(
      fixture.wrongScopeCompleted,
    ));
    await store.settleTurn(fixture.completed);
    await store.settleTurn(fixture.completed);
    await assert.rejects(() => store.settleTurn(
      fixture.conflictingCompleted,
    ));
    await assert.rejects(() => store.settleTurn(
      fixture.conflictingSettledAt,
    ));
    await assert.rejects(() => store.recordAccepted(fixture.accepted));
    assert.deepEqual(
      await harness.findTurn(fixture.requested),
      fixture.expectedCompleted,
    );
  }

  private static async verifyPreAcceptanceFailure(
    harness: HostedConversationTurnStoreConformanceHarness,
    fixture: z.infer<typeof StoreFixtureSchema>['storeCases'][
      'preAcceptanceFailure'
    ],
  ): Promise<void> {
    await harness.store.createTurn(fixture.requested);
    await harness.store.settleTurn(fixture.settlement);
    assert.deepEqual(await harness.findTurn(fixture.requested), {
      ...fixture.requested,
      status: fixture.settlement.status,
      failureCode: fixture.settlement.failureCode,
      settledAt: fixture.settlement.settledAt,
    });
  }

  private static async verifyScopedExpiry(
    harness: HostedConversationTurnStoreConformanceHarness,
    fixture: z.infer<typeof StoreFixtureSchema>['storeCases']['expiry'],
  ): Promise<void> {
    await Promise.all([
      harness.store.createTurn(fixture.expiredRequested),
      harness.store.createTurn(fixture.expiredRunning),
      harness.store.createTurn(fixture.futureRequested),
      harness.store.createTurn(fixture.terminalRequested),
      harness.store.createTurn(fixture.otherScopeExpired),
    ]);
    await harness.store.recordAccepted(fixture.expiredRunningAcceptance);
    await harness.store.settleTurn(fixture.terminalSettlement);

    await harness.store.interruptExpiredTurns(fixture.reconciliation);

    for (const expired of [
      fixture.expiredRequested,
      fixture.expiredRunning,
    ]) {
      assert.deepEqual(await harness.findTurn(expired), {
        ...expired,
        ...(expired.invocationId === fixture.expiredRunning.invocationId
          ? {
              status: 'interrupted',
              runId: fixture.expiredRunningAcceptance.runId,
              acceptedAt: fixture.expiredRunningAcceptance.acceptedAt,
            }
          : { status: 'interrupted' }),
        failureCode: 'deadline_elapsed',
        settledAt: fixture.reconciliation.settledAt,
      });
    }
    assert.equal(
      (await harness.findTurn(fixture.futureRequested))?.status,
      'requested',
    );
    assert.equal(
      (await harness.findTurn(fixture.terminalRequested))?.status,
      'failed',
    );
    assert.equal(
      (await harness.findTurn(fixture.otherScopeExpired))?.status,
      'requested',
    );
  }
}

async function loadStoreFixture(): Promise<
  z.infer<typeof StoreFixtureSchema>['storeCases']
> {
  const raw = JSON.parse(await readFile(fixtureUrl, 'utf8')) as unknown;
  return StoreFixtureSchema.parse(raw).storeCases;
}
