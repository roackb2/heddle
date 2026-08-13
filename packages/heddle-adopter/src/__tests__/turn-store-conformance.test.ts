import { describe, it } from 'vitest';
import type {
  HostedConversationAcceptedTurn,
  HostedConversationExpiredTurnReconciliation,
  HostedConversationRequestedTurn,
  HostedConversationTurnIdentity,
  HostedConversationTurnLifecycleRecord,
  HostedConversationTurnLifecycleStore,
  HostedConversationTurnSettlement,
} from '../conversation/index.js';
import {
  HostedConversationTurnStoreConformance,
} from '../testing/index.js';

describe('hosted conversation turn store conformance', () => {
  it('certifies a lifecycle store independent of its persistence backend', async () => {
    const store = new InMemoryLifecycleStore();
    await HostedConversationTurnStoreConformance.verify({
      store,
      findTurn: (identity) => store.findTurn(identity),
      clear: () => store.clear(),
    });
  });
});

class InMemoryLifecycleStore implements HostedConversationTurnLifecycleStore {
  readonly #turns = new Map<string, HostedConversationTurnLifecycleRecord>();

  async createTurn(input: HostedConversationRequestedTurn): Promise<void> {
    if (this.#turns.has(input.invocationId)) {
      throw new Error('Invocation already exists.');
    }
    this.#turns.set(input.invocationId, { ...input, status: 'requested' });
  }

  async recordAccepted(input: HostedConversationAcceptedTurn): Promise<void> {
    const record = this.#requireScoped(input);
    if (
      record.status === 'running'
      && record.runId === input.runId
      && record.acceptedAt === input.acceptedAt
    ) {
      return;
    }
    if (record.status !== 'requested') {
      throw new Error('Invalid accepted transition.');
    }
    this.#turns.set(input.invocationId, {
      ...record,
      status: 'running',
      runId: input.runId,
      acceptedAt: input.acceptedAt,
    });
  }

  async settleTurn(input: HostedConversationTurnSettlement): Promise<void> {
    const record = this.#requireScoped(input);
    if (
      !['requested', 'running'].includes(record.status)
      && record.status === input.status
      && record.summary === readSummary(input)
      && record.failureCode === readFailureCode(input)
      && record.settledAt === input.settledAt
    ) {
      return;
    }
    if (!['requested', 'running'].includes(record.status)) {
      throw new Error('Invalid terminal transition.');
    }
    if (
      record.status === 'requested'
      && !['failed', 'interrupted'].includes(input.status)
    ) {
      throw new Error('Invalid pre-acceptance terminal transition.');
    }
    this.#turns.set(input.invocationId, {
      ...record,
      status: input.status,
      ...(readSummary(input) !== undefined
        ? { summary: readSummary(input) }
        : {}),
      ...(readFailureCode(input) !== undefined
        ? { failureCode: readFailureCode(input) }
        : {}),
      settledAt: input.settledAt,
    });
  }

  async interruptExpiredTurns(
    input: HostedConversationExpiredTurnReconciliation,
  ): Promise<void> {
    this.#turns.forEach((record, invocationId) => {
      if (
        sameScope(record.scope, input.scope)
        && ['requested', 'running'].includes(record.status)
        && record.deadlineAt
        && record.deadlineAt < input.expiredBefore
      ) {
        this.#turns.set(invocationId, {
          ...record,
          status: 'interrupted',
          failureCode: 'deadline_elapsed',
          settledAt: input.settledAt,
        });
      }
    });
  }

  async findTurn(
    identity: HostedConversationTurnIdentity,
  ): Promise<HostedConversationTurnLifecycleRecord | undefined> {
    const record = this.#turns.get(identity.invocationId);
    return record && sameScope(record.scope, identity.scope)
      ? structuredClone(record)
      : undefined;
  }

  async clear(): Promise<void> {
    this.#turns.clear();
  }

  #requireScoped(
    identity: HostedConversationTurnIdentity,
  ): HostedConversationTurnLifecycleRecord {
    const record = this.#turns.get(identity.invocationId);
    if (!record || !sameScope(record.scope, identity.scope)) {
      throw new Error('Invocation not found in scope.');
    }
    return record;
  }
}

function sameScope(
  left: HostedConversationTurnIdentity['scope'],
  right: HostedConversationTurnIdentity['scope'],
): boolean {
  return left.tenantId === right.tenantId
    && left.subjectId === right.subjectId
    && left.productSessionId === right.productSessionId;
}

function readSummary(
  settlement: HostedConversationTurnSettlement,
): string | undefined {
  return 'summary' in settlement ? settlement.summary : undefined;
}

function readFailureCode(
  settlement: HostedConversationTurnSettlement,
): HostedConversationTurnLifecycleRecord['failureCode'] {
  return 'failureCode' in settlement ? settlement.failureCode : undefined;
}
