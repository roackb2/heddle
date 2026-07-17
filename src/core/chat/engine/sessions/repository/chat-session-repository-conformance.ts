/**
 * Runner-neutral contract tests for `ChatSessionRepository` adapters.
 *
 * Hosts supply fresh, scope-bound repository instances and lifecycle hooks.
 * Heddle owns the behavioral assertions so adapters do not each reproduce a
 * subtly different correctness matrix.
 */
import { randomUUID } from 'node:crypto';
import isEqual from 'lodash/isEqual.js';
import type { ChatSession } from '@/core/chat/types.js';
import {
  ChatSessionAlreadyExistsError,
  ChatSessionRepositoryConformanceError,
  ChatSessionRevisionConflictError,
} from './errors.js';
import type {
  ChatSessionCatalogEntry,
  ChatSessionRepository,
  ListChatSessionsInput,
} from './types.js';

type MaybePromise<T> = T | Promise<T>;

export type CorruptChatSessionRecordInput = {
  scopeId: string;
  sessionId: string;
};

export type ChatSessionRepositoryConformanceHarness = {
  /** Return a new repository instance bound to only this opaque test scope. */
  createRepository(scopeId: string): MaybePromise<ChatSessionRepository>;
  /** Remove all records and resources created for one opaque test scope. */
  cleanupScope(scopeId: string): MaybePromise<void>;
  /** Make the current record malformed while leaving it addressable by ID. */
  corruptSessionRecord(input: CorruptChatSessionRecordInput): MaybePromise<void>;
};

export type ChatSessionRepositoryConformanceScenario = Readonly<{
  name: string;
  run: () => Promise<void>;
}>;

type ScenarioOperation = (
  scopeIds: readonly string[],
  harness: ChatSessionRepositoryConformanceHarness,
) => Promise<void>;

type PageFilters = Pick<ListChatSessionsInput, 'workspaceId' | 'archived'>;

const timestamp = {
  first: '2026-01-01T00:00:00.000Z',
  second: '2026-01-02T00:00:00.000Z',
  third: '2026-01-03T00:00:00.000Z',
  fourth: '2026-01-04T00:00:00.000Z',
} as const;

const scenarioName = {
  crud: 'CRUD returns exact records and monotonic revisions',
  atomicWrites: 'concurrent create and update enforce atomic uniqueness and CAS',
  pagination: 'cursor pagination is stable across pinned, timestamp, and UTF-8 ties',
  filters: 'workspace and archive filters apply before page boundaries',
  scopeIsolation: 'scope-bound repositories isolate identical session IDs',
  reopen: 'fresh repository instances reopen complete session state',
  corruption: 'malformed stored records propagate as read failures',
  pageLimits: 'invalid page limits are rejected',
} as const;

/**
 * Canonical behavioral suite for certifying a custom session repository.
 *
 * `createScenarios` integrates with any test runner that accepts named async
 * callbacks. `runAll` is useful for scripts and smoke checks.
 */
export class ChatSessionRepositoryConformance {
  static createScenarios(
    harness: ChatSessionRepositoryConformanceHarness,
  ): ChatSessionRepositoryConformanceScenario[] {
    return [
      ChatSessionRepositoryConformance.createScenario(
        scenarioName.crud,
        harness,
        1,
        ChatSessionRepositoryConformance.verifyCrud,
      ),
      ChatSessionRepositoryConformance.createScenario(
        scenarioName.atomicWrites,
        harness,
        1,
        ChatSessionRepositoryConformance.verifyAtomicWrites,
      ),
      ChatSessionRepositoryConformance.createScenario(
        scenarioName.pagination,
        harness,
        1,
        ChatSessionRepositoryConformance.verifyPagination,
      ),
      ChatSessionRepositoryConformance.createScenario(
        scenarioName.filters,
        harness,
        1,
        ChatSessionRepositoryConformance.verifyFilters,
      ),
      ChatSessionRepositoryConformance.createScenario(
        scenarioName.scopeIsolation,
        harness,
        2,
        ChatSessionRepositoryConformance.verifyScopeIsolation,
      ),
      ChatSessionRepositoryConformance.createScenario(
        scenarioName.reopen,
        harness,
        1,
        ChatSessionRepositoryConformance.verifyReopen,
      ),
      ChatSessionRepositoryConformance.createScenario(
        scenarioName.corruption,
        harness,
        1,
        ChatSessionRepositoryConformance.verifyCorruption,
      ),
      ChatSessionRepositoryConformance.createScenario(
        scenarioName.pageLimits,
        harness,
        1,
        ChatSessionRepositoryConformance.verifyPageLimits,
      ),
    ];
  }

  static async runAll(
    harness: ChatSessionRepositoryConformanceHarness,
  ): Promise<void> {
    for (const scenario of ChatSessionRepositoryConformance.createScenarios(harness)) {
      await scenario.run();
    }
  }

  private static createScenario(
    name: string,
    harness: ChatSessionRepositoryConformanceHarness,
    scopeCount: number,
    operation: ScenarioOperation,
  ): ChatSessionRepositoryConformanceScenario {
    return {
      name,
      run: async () => {
        const scopeIds = Array.from({ length: scopeCount }, () => randomUUID());
        await ChatSessionRepositoryConformance.runWithCleanup(
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
    harness: ChatSessionRepositoryConformanceHarness,
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
      throw new ChatSessionRepositoryConformanceError(
        scenario,
        'the scenario and scope cleanup both failed',
        { cause: new AggregateError([operationError, ...cleanupErrors]) },
      );
    }
    if (operationError instanceof ChatSessionRepositoryConformanceError) {
      throw operationError;
    }
    if (operationFailed) {
      throw new ChatSessionRepositoryConformanceError(
        scenario,
        'the adapter operation failed unexpectedly',
        { cause: operationError },
      );
    }
    if (cleanupErrors.length > 0) {
      throw new ChatSessionRepositoryConformanceError(
        scenario,
        'scope cleanup failed',
        { cause: new AggregateError(cleanupErrors) },
      );
    }
  }

  private static async verifyCrud(
    [scopeId]: readonly string[],
    harness: ChatSessionRepositoryConformanceHarness,
  ): Promise<void> {
    const scenario = scenarioName.crud;
    const repository = await ChatSessionRepositoryConformance.repository(harness, scopeId);
    const original = ChatSessionRepositoryConformance.session('crud-session', {
      name: 'Original session',
    });

    ChatSessionRepositoryConformance.equal(
      await repository.read(original.id),
      undefined,
      scenario,
      'read must return undefined for a missing session',
    );
    const created = await repository.create(original);
    ChatSessionRepositoryConformance.equal(
      created,
      { session: original, revision: 1 },
      scenario,
      'create must preserve the exact record at revision 1',
    );

    const updatedSession = {
      ...original,
      name: 'Updated session',
      updatedAt: timestamp.second,
    };
    const updated = await repository.update({
      session: updatedSession,
      expectedRevision: created.revision,
    });
    ChatSessionRepositoryConformance.equal(
      updated,
      { session: updatedSession, revision: 2 },
      scenario,
      'update must preserve the exact record and increment the revision',
    );
    ChatSessionRepositoryConformance.equal(
      await repository.read(original.id),
      updated,
      scenario,
      'read must return the latest stored revision',
    );
    ChatSessionRepositoryConformance.equal(
      await repository.update({
        session: ChatSessionRepositoryConformance.session('missing-update'),
        expectedRevision: 1,
      }),
      undefined,
      scenario,
      'updating a missing session must return undefined',
    );

    ChatSessionRepositoryConformance.equal(
      await repository.delete({ sessionId: original.id, expectedRevision: 2 }),
      true,
      scenario,
      'delete must report a removed session',
    );
    ChatSessionRepositoryConformance.equal(
      await repository.read(original.id),
      undefined,
      scenario,
      'deleted sessions must no longer be readable',
    );
    ChatSessionRepositoryConformance.equal(
      await repository.delete({ sessionId: original.id, expectedRevision: 2 }),
      false,
      scenario,
      'deleting a missing session must return false',
    );
  }

  private static async verifyAtomicWrites(
    [scopeId]: readonly string[],
    harness: ChatSessionRepositoryConformanceHarness,
  ): Promise<void> {
    const scenario = scenarioName.atomicWrites;
    const [first, second] = await Promise.all([
      ChatSessionRepositoryConformance.repository(harness, scopeId),
      ChatSessionRepositoryConformance.repository(harness, scopeId),
    ]);
    ChatSessionRepositoryConformance.expect(
      first !== second,
      scenario,
      'createRepository must return a fresh instance for each call',
    );
    const session = ChatSessionRepositoryConformance.session('race-session');
    const createResults = await Promise.allSettled([
      first.create(session),
      second.create(session),
    ]);

    ChatSessionRepositoryConformance.expect(
      createResults.filter((result) => result.status === 'fulfilled').length === 1,
      scenario,
      'exactly one concurrent create must succeed',
    );
    const createRejection = createResults.find((result) => result.status === 'rejected');
    ChatSessionRepositoryConformance.expect(
      createRejection?.status === 'rejected'
      && createRejection.reason instanceof ChatSessionAlreadyExistsError,
      scenario,
      'the losing create must throw ChatSessionAlreadyExistsError',
    );

    const [firstRead, secondRead] = await Promise.all([
      first.read(session.id),
      second.read(session.id),
    ]);
    const firstStored = ChatSessionRepositoryConformance.value(
      firstRead,
      scenario,
      'the first repository must observe the created record',
    );
    const secondStored = ChatSessionRepositoryConformance.value(
      secondRead,
      scenario,
      'the second repository must observe the created record',
    );
    const updateResults = await Promise.allSettled([
      first.update({
        session: { ...firstStored.session, name: 'First writer' },
        expectedRevision: firstStored.revision,
      }),
      second.update({
        session: { ...secondStored.session, name: 'Second writer' },
        expectedRevision: secondStored.revision,
      }),
    ]);

    ChatSessionRepositoryConformance.expect(
      updateResults.filter((result) => result.status === 'fulfilled').length === 1,
      scenario,
      'exactly one concurrent update must succeed',
    );
    const updateRejection = updateResults.find((result) => result.status === 'rejected');
    ChatSessionRepositoryConformance.expect(
      updateRejection?.status === 'rejected'
      && updateRejection.reason instanceof ChatSessionRevisionConflictError,
      scenario,
      'the losing update must throw ChatSessionRevisionConflictError',
    );
    const persisted = ChatSessionRepositoryConformance.value(
      await first.read(session.id),
      scenario,
      'the winning update must remain readable',
    );
    ChatSessionRepositoryConformance.expect(
      persisted.revision === 2
      && ['First writer', 'Second writer'].includes(persisted.session.name),
      scenario,
      'the winning update must be the only revision 2 record',
    );
    await ChatSessionRepositoryConformance.rejects(
      () => second.delete({ sessionId: session.id, expectedRevision: 1 }),
      (error) => error instanceof ChatSessionRevisionConflictError,
      scenario,
      'a stale delete must throw ChatSessionRevisionConflictError',
    );
  }

  private static async verifyPagination(
    [scopeId]: readonly string[],
    harness: ChatSessionRepositoryConformanceHarness,
  ): Promise<void> {
    const scenario = scenarioName.pagination;
    const repository = await ChatSessionRepositoryConformance.repository(harness, scopeId);
    const sessions = [
      ChatSessionRepositoryConformance.session('Z', { pinned: true, updatedAt: timestamp.second }),
      ChatSessionRepositoryConformance.session('a', { pinned: true, updatedAt: timestamp.second }),
      ChatSessionRepositoryConformance.session('regular-new', { updatedAt: timestamp.fourth }),
      ChatSessionRepositoryConformance.session('regular-a', { updatedAt: timestamp.third }),
      ChatSessionRepositoryConformance.session('regular-b', { updatedAt: timestamp.third }),
      ChatSessionRepositoryConformance.session('\uE000', { updatedAt: timestamp.second }),
      ChatSessionRepositoryConformance.session('😀', { updatedAt: timestamp.second }),
      ChatSessionRepositoryConformance.session('regular-old', { updatedAt: timestamp.first }),
    ];
    for (const session of sessions) {
      await repository.create(session);
    }

    const entries = await ChatSessionRepositoryConformance.collectPages(
      repository,
      { limit: 2 },
      scenario,
    );
    const actualIds = entries.map((entry) => entry.id);
    ChatSessionRepositoryConformance.equal(
      actualIds,
      ['Z', 'a', 'regular-new', 'regular-a', 'regular-b', '\uE000', '😀', 'regular-old'],
      scenario,
      'pages must follow pinned, updatedAt, and binary UTF-8 ID ordering',
    );
    ChatSessionRepositoryConformance.expect(
      new Set(actualIds).size === actualIds.length,
      scenario,
      'page traversal must not repeat records',
    );
  }

  private static async verifyFilters(
    [scopeId]: readonly string[],
    harness: ChatSessionRepositoryConformanceHarness,
  ): Promise<void> {
    const scenario = scenarioName.filters;
    const repository = await ChatSessionRepositoryConformance.repository(harness, scopeId);
    const sessions = [
      ChatSessionRepositoryConformance.session('active-a-new', {
        workspaceId: 'workspace-a',
        updatedAt: timestamp.fourth,
      }),
      ChatSessionRepositoryConformance.session('active-a-old', {
        workspaceId: 'workspace-a',
        updatedAt: timestamp.first,
      }),
      ChatSessionRepositoryConformance.session('archived-a', {
        workspaceId: 'workspace-a',
        archivedAt: timestamp.third,
        updatedAt: timestamp.third,
      }),
      ChatSessionRepositoryConformance.session('active-b', {
        workspaceId: 'workspace-b',
        updatedAt: timestamp.third,
      }),
      ChatSessionRepositoryConformance.session('archived-b', {
        workspaceId: 'workspace-b',
        archivedAt: timestamp.second,
        updatedAt: timestamp.second,
      }),
    ];
    for (const session of sessions) {
      await repository.create(session);
    }

    const activeA = await ChatSessionRepositoryConformance.collectPages(
      repository,
      { limit: 1, workspaceId: 'workspace-a', archived: false },
      scenario,
    );
    ChatSessionRepositoryConformance.equal(
      activeA.map((entry) => entry.id),
      ['active-a-new', 'active-a-old'],
      scenario,
      'workspace/archive filters must be applied before pagination',
    );
    const archivedA = await ChatSessionRepositoryConformance.collectPages(
      repository,
      { limit: 1, workspaceId: 'workspace-a', archived: true },
      scenario,
    );
    ChatSessionRepositoryConformance.equal(
      archivedA.map((entry) => entry.id),
      ['archived-a'],
      scenario,
      'archive filtering must not leak another workspace',
    );
  }

  private static async verifyScopeIsolation(
    scopeIds: readonly string[],
    harness: ChatSessionRepositoryConformanceHarness,
  ): Promise<void> {
    const scenario = scenarioName.scopeIsolation;
    const [firstScope, secondScope] = scopeIds;
    const [first, second] = await Promise.all([
      ChatSessionRepositoryConformance.repository(harness, firstScope),
      ChatSessionRepositoryConformance.repository(harness, secondScope),
    ]);
    const firstSession = ChatSessionRepositoryConformance.session('shared-id', {
      name: 'First scope',
    });
    const secondSession = ChatSessionRepositoryConformance.session('shared-id', {
      name: 'Second scope',
    });
    await Promise.all([first.create(firstSession), second.create(secondSession)]);

    ChatSessionRepositoryConformance.equal(
      (await first.list({ limit: 10 })).items.map((entry) => entry.name),
      ['First scope'],
      scenario,
      'the first scope list must contain only its own record',
    );
    ChatSessionRepositoryConformance.equal(
      (await second.list({ limit: 10 })).items.map((entry) => entry.name),
      ['Second scope'],
      scenario,
      'the second scope list must contain only its own record',
    );

    await first.update({
      session: { ...firstSession, name: 'First scope updated' },
      expectedRevision: 1,
    });
    await first.delete({ sessionId: firstSession.id, expectedRevision: 2 });
    ChatSessionRepositoryConformance.equal(
      await first.read(firstSession.id),
      undefined,
      scenario,
      'deleting in the first scope must remove only its own record',
    );
    ChatSessionRepositoryConformance.equal(
      await second.read(secondSession.id),
      { session: secondSession, revision: 1 },
      scenario,
      'the second scope record must remain unchanged',
    );
  }

  private static async verifyReopen(
    [scopeId]: readonly string[],
    harness: ChatSessionRepositoryConformanceHarness,
  ): Promise<void> {
    const scenario = scenarioName.reopen;
    const first = await ChatSessionRepositoryConformance.repository(harness, scopeId);
    const original = ChatSessionRepositoryConformance.richSession('reopen-session');
    await first.create(original);

    const second = await ChatSessionRepositoryConformance.repository(harness, scopeId);
    ChatSessionRepositoryConformance.expect(
      first !== second,
      scenario,
      'reopen must use a fresh repository instance',
    );
    const reopened = ChatSessionRepositoryConformance.value(
      await second.read(original.id),
      scenario,
      'a fresh repository instance must reopen the record',
    );
    ChatSessionRepositoryConformance.equal(
      reopened,
      { session: original, revision: 1 },
      scenario,
      'reopen must preserve the complete opaque session record',
    );
    const updatedSession = {
      ...reopened.session,
      name: 'Reopened and updated',
      updatedAt: timestamp.fourth,
    };
    await second.update({ session: updatedSession, expectedRevision: reopened.revision });

    const third = await ChatSessionRepositoryConformance.repository(harness, scopeId);
    ChatSessionRepositoryConformance.expect(
      second !== third,
      scenario,
      'the post-update read must use another fresh repository instance',
    );
    ChatSessionRepositoryConformance.equal(
      await third.read(original.id),
      { session: updatedSession, revision: 2 },
      scenario,
      'a third instance must observe the reopened update',
    );
  }

  private static async verifyCorruption(
    [scopeId]: readonly string[],
    harness: ChatSessionRepositoryConformanceHarness,
  ): Promise<void> {
    const scenario = scenarioName.corruption;
    const repository = await ChatSessionRepositoryConformance.repository(harness, scopeId);
    const session = ChatSessionRepositoryConformance.session('corrupt-session');
    await repository.create(session);
    await harness.corruptSessionRecord({
      scopeId,
      sessionId: session.id,
    });
    const fresh = await ChatSessionRepositoryConformance.repository(harness, scopeId);
    await ChatSessionRepositoryConformance.rejects(
      () => fresh.read(session.id),
      () => true,
      scenario,
      'reading a malformed addressable record must reject',
    );
  }

  private static async verifyPageLimits(
    [scopeId]: readonly string[],
    harness: ChatSessionRepositoryConformanceHarness,
  ): Promise<void> {
    const scenario = scenarioName.pageLimits;
    const repository = await ChatSessionRepositoryConformance.repository(harness, scopeId);
    for (const limit of [0, 201, 1.5]) {
      await ChatSessionRepositoryConformance.rejects(
        () => repository.list({ limit }),
        () => true,
        scenario,
        `list must reject invalid page limit ${limit}`,
      );
    }
  }

  private static async repository(
    harness: ChatSessionRepositoryConformanceHarness,
    scopeId: string | undefined,
  ): Promise<ChatSessionRepository> {
    if (!scopeId) {
      throw new Error('Conformance scenario did not receive its required scope.');
    }
    return await harness.createRepository(scopeId);
  }

  private static async collectPages(
    repository: ChatSessionRepository,
    input: PageFilters & { limit: number },
    scenario: string,
  ): Promise<ChatSessionCatalogEntry[]> {
    const items: ChatSessionCatalogEntry[] = [];
    const cursors = new Set<string>();
    let cursor: string | undefined;

    for (let pageNumber = 0; pageNumber < 100; pageNumber += 1) {
      const page = await repository.list({ ...input, cursor });
      ChatSessionRepositoryConformance.expect(
        page.items.length <= input.limit,
        scenario,
        'a page must not exceed its requested limit',
      );
      items.push(...page.items);
      if (!page.nextCursor) {
        return items;
      }
      ChatSessionRepositoryConformance.expect(
        !cursors.has(page.nextCursor),
        scenario,
        'page cursors must advance without a loop',
      );
      cursors.add(page.nextCursor);
      cursor = page.nextCursor;
    }

    throw new ChatSessionRepositoryConformanceError(
      scenario,
      'page traversal exceeded 100 pages without terminating',
    );
  }

  private static session(
    id: string,
    overrides: Partial<ChatSession> = {},
  ): ChatSession {
    return {
      id,
      name: `Session ${id}`,
      retention: 'reusable',
      workspaceId: 'workspace-default',
      pinned: false,
      model: 'gpt-5.4-mini',
      reasoningEffort: 'medium',
      driftEnabled: false,
      lastContinuePrompt: 'Continue.',
      context: { estimatedHistoryTokens: 0 },
      archives: [],
      lease: {
        ownerKind: 'daemon',
        ownerId: 'conformance-owner',
        acquiredAt: timestamp.first,
        lastSeenAt: timestamp.first,
      },
      history: [],
      messages: [],
      turns: [],
      createdAt: timestamp.first,
      updatedAt: timestamp.first,
      queuedPrompts: [],
      ...overrides,
    };
  }

  private static richSession(id: string): ChatSession {
    return ChatSessionRepositoryConformance.session(id, {
      name: 'Rich session',
      workspaceId: 'workspace-rich',
      pinned: true,
      history: [
        { role: 'system', content: 'Work carefully.' },
        { role: 'user', content: 'Inspect the project.' },
        {
          role: 'assistant',
          content: 'I will inspect it.',
          toolCalls: [{ id: 'call-1', tool: 'read_file', input: { path: 'README.md' } }],
        },
        { role: 'tool', content: '{"ok":true}', toolCallId: 'call-1' },
      ],
      messages: [
        { id: 'line-1', role: 'user', text: 'Inspect the project.' },
        { id: 'line-2', role: 'assistant', text: 'Inspection complete.' },
      ],
      turns: [{
        id: 'turn-1',
        prompt: 'Inspect the project.',
        outcome: 'done',
        summary: 'Inspected the project.',
        steps: 2,
        traceFile: '/var/lib/agent/traces/turn-1.json',
        events: ['read README.md'],
      }],
      model: 'gpt-5.4',
      reasoningEffort: 'high',
      driftEnabled: true,
      lastContinuePrompt: 'Continue the inspection.',
      context: {
        estimatedHistoryTokens: 128,
        request: {
          estimatedTokens: 64,
          toolNames: ['read_file'],
          goal: 'Inspect the project.',
          usage: { inputTokens: 60, outputTokens: 20, totalTokens: 80 },
        },
        compaction: {
          compactedMessages: 4,
          compactedAt: timestamp.second,
          status: 'idle',
        },
        archive: {
          count: 1,
          currentSummaryPath: '/var/lib/agent/archives/current.md',
          lastArchivePath: '/var/lib/agent/archives/archive-1.json',
        },
      },
      archives: [{
        id: 'archive-1',
        path: '/var/lib/agent/archives/archive-1.json',
        summaryPath: '/var/lib/agent/archives/archive-1.md',
        shortDescription: 'Initial inspection',
        messageCount: 4,
        createdAt: timestamp.second,
        summaryModel: 'gpt-5.4',
      }],
      lease: {
        ownerKind: 'daemon',
        ownerId: 'daemon-1',
        acquiredAt: timestamp.second,
        lastSeenAt: timestamp.third,
        clientLabel: 'Hosted agent',
      },
      queuedPrompts: [{
        id: 'queued-1',
        prompt: 'Then inspect the tests.',
        agentProfileId: 'reviewer',
        systemContext: 'Use read-only tools.',
        createdAt: timestamp.second,
        updatedAt: timestamp.third,
      }],
    });
  }

  private static expect(
    condition: boolean,
    scenario: string,
    detail: string,
  ): asserts condition {
    if (!condition) {
      throw new ChatSessionRepositoryConformanceError(scenario, detail);
    }
  }

  private static equal(
    actual: unknown,
    expected: unknown,
    scenario: string,
    detail: string,
  ): void {
    ChatSessionRepositoryConformance.expect(isEqual(actual, expected), scenario, detail);
  }

  private static value<T>(
    value: T | undefined,
    scenario: string,
    detail: string,
  ): T {
    ChatSessionRepositoryConformance.expect(value !== undefined, scenario, detail);
    return value;
  }

  private static async rejects(
    operation: () => Promise<unknown>,
    matches: (error: unknown) => boolean,
    scenario: string,
    detail: string,
  ): Promise<void> {
    try {
      await operation();
    } catch (error) {
      if (matches(error)) {
        return;
      }
      throw new ChatSessionRepositoryConformanceError(scenario, detail, { cause: error });
    }
    throw new ChatSessionRepositoryConformanceError(scenario, detail);
  }
}
