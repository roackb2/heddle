/**
 * Runner-neutral contract tests for `ChatArchiveRepository` adapters.
 *
 * Hosts supply fresh, scope-bound repository instances plus lifecycle and
 * corruption hooks. Heddle owns the assertions so file and remote adapters are
 * certified against one append, isolation, and recovery contract.
 */
import { randomUUID } from 'node:crypto';
import isEqual from 'lodash/isEqual.js';
import type { ChatArchiveManifest, ChatArchiveRecord } from '@/core/chat/types.js';
import { ChatArchiveRepositoryConformanceError } from './errors.js';
import type {
  AppendChatArchiveInput,
  ChatArchiveRepository,
} from './types.js';

type MaybePromise<T> = T | Promise<T>;

export type CorruptChatArchiveManifestInput = {
  scopeId: string;
  sessionId: string;
};

export type ChatArchiveRepositoryConformanceHarness = {
  /** Return a new repository instance bound to only this opaque test scope. */
  createRepository(scopeId: string): MaybePromise<ChatArchiveRepository>;
  /** Remove all records and resources created for one opaque test scope. */
  cleanupScope(scopeId: string): MaybePromise<void>;
  /** Make one existing manifest malformed while leaving it addressable. */
  corruptManifest(input: CorruptChatArchiveManifestInput): MaybePromise<void>;
};

export type ChatArchiveRepositoryConformanceScenario = Readonly<{
  name: string;
  run: () => Promise<void>;
}>;

type ScenarioOperation = (
  scopeIds: readonly string[],
  harness: ChatArchiveRepositoryConformanceHarness,
) => Promise<void>;

const timestamp = {
  first: '2026-01-01T00:00:00.000Z',
  second: '2026-01-02T00:00:00.000Z',
} as const;

const scenarioName = {
  appendOrder: 'append preserves manifest order and readable summaries',
  atomicAppends: 'concurrent appends commit complete non-conflicting archives',
  duplicateConflict: 'duplicate archive ids reject without changing committed state',
  scopeIsolation: 'scope-bound repositories isolate identical archive addresses',
  reopen: 'fresh repository instances reopen complete archive state',
  corruption: 'malformed stored manifests propagate as read failures',
} as const;

/**
 * Canonical behavioral suite for certifying a custom archive repository.
 *
 * `createScenarios` integrates with any test runner that accepts named async
 * callbacks. `runAll` is useful for scripts and smoke checks.
 *
 * The v1 archive port exposes one authoritative append-ordered manifest per
 * session. It deliberately has no cursor/page operation; hosts should not add
 * adapter-specific pagination semantics to this conformance boundary.
 */
export class ChatArchiveRepositoryConformance {
  static createScenarios(
    harness: ChatArchiveRepositoryConformanceHarness,
  ): ChatArchiveRepositoryConformanceScenario[] {
    return [
      ChatArchiveRepositoryConformance.createScenario(
        scenarioName.appendOrder,
        harness,
        1,
        ChatArchiveRepositoryConformance.verifyAppendOrder,
      ),
      ChatArchiveRepositoryConformance.createScenario(
        scenarioName.atomicAppends,
        harness,
        1,
        ChatArchiveRepositoryConformance.verifyAtomicAppends,
      ),
      ChatArchiveRepositoryConformance.createScenario(
        scenarioName.duplicateConflict,
        harness,
        1,
        ChatArchiveRepositoryConformance.verifyDuplicateConflict,
      ),
      ChatArchiveRepositoryConformance.createScenario(
        scenarioName.scopeIsolation,
        harness,
        2,
        ChatArchiveRepositoryConformance.verifyScopeIsolation,
      ),
      ChatArchiveRepositoryConformance.createScenario(
        scenarioName.reopen,
        harness,
        1,
        ChatArchiveRepositoryConformance.verifyReopen,
      ),
      ChatArchiveRepositoryConformance.createScenario(
        scenarioName.corruption,
        harness,
        1,
        ChatArchiveRepositoryConformance.verifyCorruption,
      ),
    ];
  }

  static async runAll(
    harness: ChatArchiveRepositoryConformanceHarness,
  ): Promise<void> {
    for (const scenario of ChatArchiveRepositoryConformance.createScenarios(harness)) {
      await scenario.run();
    }
  }

  private static createScenario(
    name: string,
    harness: ChatArchiveRepositoryConformanceHarness,
    scopeCount: number,
    operation: ScenarioOperation,
  ): ChatArchiveRepositoryConformanceScenario {
    return {
      name,
      run: async () => {
        const scopeIds = Array.from({ length: scopeCount }, () => randomUUID());
        await ChatArchiveRepositoryConformance.runWithCleanup(
          name,
          harness,
          scopeIds,
          operation,
        );
      },
    };
  }

  private static async runWithCleanup(
    scenario: string,
    harness: ChatArchiveRepositoryConformanceHarness,
    scopeIds: readonly string[],
    operation: ScenarioOperation,
  ): Promise<void> {
    let operationFailed = false;
    let operationError: unknown;
    try {
      await operation(scopeIds, harness);
    } catch (error) {
      operationFailed = true;
      operationError = error;
    }

    const cleanupResults = await Promise.allSettled(
      scopeIds.map(async (scopeId) => await harness.cleanupScope(scopeId)),
    );
    const cleanupErrors = cleanupResults.flatMap((result) =>
      result.status === 'rejected' ? [result.reason as unknown] : []
    );

    if (operationFailed && cleanupErrors.length > 0) {
      throw new ChatArchiveRepositoryConformanceError(
        scenario,
        'the scenario and scope cleanup both failed',
        { cause: new AggregateError([operationError, ...cleanupErrors]) },
      );
    }
    if (operationError instanceof ChatArchiveRepositoryConformanceError) {
      throw operationError;
    }
    if (operationFailed) {
      throw new ChatArchiveRepositoryConformanceError(
        scenario,
        'the adapter operation failed unexpectedly',
        { cause: operationError },
      );
    }
    if (cleanupErrors.length > 0) {
      throw new ChatArchiveRepositoryConformanceError(
        scenario,
        'scope cleanup failed',
        { cause: new AggregateError(cleanupErrors) },
      );
    }
  }

  private static async verifyAppendOrder(
    [scopeId]: readonly string[],
    harness: ChatArchiveRepositoryConformanceHarness,
  ): Promise<void> {
    const scenario = scenarioName.appendOrder;
    const repository = await ChatArchiveRepositoryConformance.repository(harness, scopeId);
    const sessionId = 'ordered-session';
    ChatArchiveRepositoryConformance.equal(
      await repository.loadManifest(sessionId),
      ChatArchiveRepositoryConformance.emptyManifest(sessionId),
      scenario,
      'a missing session must load as an empty manifest',
    );

    const firstInput = ChatArchiveRepositoryConformance.input(
      sessionId,
      'archive-first',
      'First summary.\n',
      timestamp.second,
    );
    const secondInput = ChatArchiveRepositoryConformance.input(
      sessionId,
      'archive-second',
      'Second summary.\n',
      timestamp.first,
    );
    const first = await repository.append(firstInput);
    const second = await repository.append(secondInput);

    ChatArchiveRepositoryConformance.equal(
      second.manifest.archives,
      [first.archive, second.archive],
      scenario,
      'manifest archives must remain in append order rather than timestamp order',
    );
    ChatArchiveRepositoryConformance.equal(
      second.manifest.currentSummaryPath,
      second.archive.summaryPath,
      scenario,
      'the latest appended archive must own the current summary locator',
    );
    await ChatArchiveRepositoryConformance.expectReadableSummary(
      repository,
      first.archive,
      firstInput.summary,
      scenario,
    );
    await ChatArchiveRepositoryConformance.expectReadableSummary(
      repository,
      second.archive,
      secondInput.summary,
      scenario,
    );
  }

  private static async verifyAtomicAppends(
    [scopeId]: readonly string[],
    harness: ChatArchiveRepositoryConformanceHarness,
  ): Promise<void> {
    const scenario = scenarioName.atomicAppends;
    const [firstRepository, secondRepository] = await Promise.all([
      ChatArchiveRepositoryConformance.repository(harness, scopeId),
      ChatArchiveRepositoryConformance.repository(harness, scopeId),
    ]);
    ChatArchiveRepositoryConformance.expect(
      firstRepository !== secondRepository,
      scenario,
      'createRepository must return a fresh instance for each call',
    );
    const sessionId = 'concurrent-session';
    const inputs = [
      ChatArchiveRepositoryConformance.input(
        sessionId,
        'archive-a',
        'Concurrent summary A.\n',
        timestamp.first,
      ),
      ChatArchiveRepositoryConformance.input(
        sessionId,
        'archive-b',
        'Concurrent summary B.\n',
        timestamp.second,
      ),
    ] as const;
    const results = await Promise.all([
      firstRepository.append(inputs[0]),
      secondRepository.append(inputs[1]),
    ]);

    const reopened = await ChatArchiveRepositoryConformance.repository(harness, scopeId);
    const manifest = await reopened.loadManifest(sessionId);
    ChatArchiveRepositoryConformance.equal(
      [...manifest.archives.map(({ id }) => id)].sort(),
      ['archive-a', 'archive-b'],
      scenario,
      'concurrent appends must not lose either archive',
    );
    ChatArchiveRepositoryConformance.expect(
      manifest.currentSummaryPath === manifest.archives.at(-1)?.summaryPath,
      scenario,
      'the manifest head must reference its final committed archive',
    );
    for (const [index, result] of results.entries()) {
      ChatArchiveRepositoryConformance.expect(
        manifest.archives.some((archive) => isEqual(archive, result.archive)),
        scenario,
        `archive ${result.archive.id} must be fully visible from the committed manifest`,
      );
      await ChatArchiveRepositoryConformance.expectReadableSummary(
        reopened,
        result.archive,
        inputs[index]?.summary ?? '',
        scenario,
      );
    }
  }

  private static async verifyDuplicateConflict(
    [scopeId]: readonly string[],
    harness: ChatArchiveRepositoryConformanceHarness,
  ): Promise<void> {
    const scenario = scenarioName.duplicateConflict;
    const repository = await ChatArchiveRepositoryConformance.repository(harness, scopeId);
    const sessionId = 'duplicate-session';
    const originalInput = ChatArchiveRepositoryConformance.input(
      sessionId,
      'archive-shared',
      'Original summary.\n',
      timestamp.first,
    );
    const original = await repository.append(originalInput);

    await ChatArchiveRepositoryConformance.rejects(
      () => repository.append({
        ...originalInput,
        summary: 'Conflicting summary.\n',
      }),
      scenario,
      'a duplicate archive id must reject',
    );
    ChatArchiveRepositoryConformance.equal(
      await repository.loadManifest(sessionId),
      original.manifest,
      scenario,
      'a rejected duplicate must not change the committed manifest',
    );
    await ChatArchiveRepositoryConformance.expectReadableSummary(
      repository,
      original.archive,
      originalInput.summary,
      scenario,
    );
  }

  private static async verifyScopeIsolation(
    scopeIds: readonly string[],
    harness: ChatArchiveRepositoryConformanceHarness,
  ): Promise<void> {
    const scenario = scenarioName.scopeIsolation;
    const [firstScope, secondScope] = scopeIds;
    const [first, second] = await Promise.all([
      ChatArchiveRepositoryConformance.repository(harness, firstScope),
      ChatArchiveRepositoryConformance.repository(harness, secondScope),
    ]);
    const sessionId = 'shared-session';
    const firstInput = ChatArchiveRepositoryConformance.input(
      sessionId,
      'shared-archive',
      'First scope summary.\n',
      timestamp.first,
    );
    const secondInput = {
      ...firstInput,
      summary: 'Second scope summary.\n',
    };
    const [firstResult, secondResult] = await Promise.all([
      first.append(firstInput),
      second.append(secondInput),
    ]);

    await ChatArchiveRepositoryConformance.expectReadableSummary(
      first,
      firstResult.archive,
      firstInput.summary,
      scenario,
    );
    await ChatArchiveRepositoryConformance.expectReadableSummary(
      second,
      secondResult.archive,
      secondInput.summary,
      scenario,
    );
    ChatArchiveRepositoryConformance.equal(
      await first.loadManifest(sessionId),
      firstResult.manifest,
      scenario,
      'the first scope must retain only its own manifest',
    );
    ChatArchiveRepositoryConformance.equal(
      await second.loadManifest(sessionId),
      secondResult.manifest,
      scenario,
      'the second scope must retain only its own manifest',
    );
  }

  private static async verifyReopen(
    [scopeId]: readonly string[],
    harness: ChatArchiveRepositoryConformanceHarness,
  ): Promise<void> {
    const scenario = scenarioName.reopen;
    const first = await ChatArchiveRepositoryConformance.repository(harness, scopeId);
    const input = ChatArchiveRepositoryConformance.input(
      'reopen-session',
      'reopen-archive',
      'Reopened summary.\n',
      timestamp.first,
    );
    const appended = await first.append(input);
    const second = await ChatArchiveRepositoryConformance.repository(harness, scopeId);

    ChatArchiveRepositoryConformance.expect(
      first !== second,
      scenario,
      'reopen must use a fresh repository instance',
    );
    ChatArchiveRepositoryConformance.equal(
      await second.loadManifest(input.sessionId),
      appended.manifest,
      scenario,
      'a fresh repository must recover the complete manifest',
    );
    await ChatArchiveRepositoryConformance.expectReadableSummary(
      second,
      appended.archive,
      input.summary,
      scenario,
    );
  }

  private static async verifyCorruption(
    [scopeId]: readonly string[],
    harness: ChatArchiveRepositoryConformanceHarness,
  ): Promise<void> {
    const scenario = scenarioName.corruption;
    const repository = await ChatArchiveRepositoryConformance.repository(harness, scopeId);
    const input = ChatArchiveRepositoryConformance.input(
      'corrupt-session',
      'corrupt-archive',
      'Summary before corruption.\n',
      timestamp.first,
    );
    await repository.append(input);
    await harness.corruptManifest({ scopeId, sessionId: input.sessionId });
    const fresh = await ChatArchiveRepositoryConformance.repository(harness, scopeId);

    await ChatArchiveRepositoryConformance.rejects(
      () => fresh.loadManifest(input.sessionId),
      scenario,
      'loading a malformed addressable manifest must reject',
    );
  }

  private static async repository(
    harness: ChatArchiveRepositoryConformanceHarness,
    scopeId: string | undefined,
  ): Promise<ChatArchiveRepository> {
    if (!scopeId) {
      throw new Error('Conformance scenario did not receive its required scope.');
    }
    return await harness.createRepository(scopeId);
  }

  private static input(
    sessionId: string,
    archiveId: string,
    summary: string,
    createdAt: string,
  ): AppendChatArchiveInput {
    return {
      sessionId,
      archive: {
        id: archiveId,
        shortDescription: `Conformance archive ${archiveId}`,
        messageCount: 2,
        createdAt,
        summaryModel: 'conformance-no-model-call',
      },
      messages: [
        { role: 'user', content: `Remember ${archiveId}.` },
        { role: 'assistant', content: `Remembered ${archiveId}.` },
      ],
      summary,
    };
  }

  private static emptyManifest(sessionId: string): ChatArchiveManifest {
    return {
      version: 1,
      sessionId,
      archives: [],
    };
  }

  private static async expectReadableSummary(
    repository: ChatArchiveRepository,
    archive: ChatArchiveRecord,
    expected: string,
    scenario: string,
  ): Promise<void> {
    ChatArchiveRepositoryConformance.equal(
      await repository.readSummary(archive.summaryPath),
      expected,
      scenario,
      `archive ${archive.id} must resolve its committed summary`,
    );
  }

  private static expect(
    condition: boolean,
    scenario: string,
    detail: string,
  ): asserts condition {
    if (!condition) {
      throw new ChatArchiveRepositoryConformanceError(scenario, detail);
    }
  }

  private static equal(
    actual: unknown,
    expected: unknown,
    scenario: string,
    detail: string,
  ): void {
    ChatArchiveRepositoryConformance.expect(isEqual(actual, expected), scenario, detail);
  }

  private static async rejects(
    operation: () => Promise<unknown>,
    scenario: string,
    detail: string,
  ): Promise<void> {
    try {
      await operation();
    } catch {
      return;
    }
    throw new ChatArchiveRepositoryConformanceError(scenario, detail);
  }
}
