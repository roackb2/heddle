import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { and, eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import {
  ChatArchiveRepositoryConformance,
  ChatSessionRepositoryConformance,
  createConversationEngine,
  type AppendChatArchiveInput,
  type ChatArchiveRepositoryConformanceHarness,
  type ChatSessionRepositoryConformanceHarness,
} from '../../../../src/index.js';
import type { PostgresStorageDatabase } from './database.js';
import { POSTGRES_REFERENCE_DATABASE_URL } from './example-config.js';
import { migratePostgresStorage } from './migration.js';
import { PostgresChatArchiveRepository } from './postgres-chat-archive-repository.js';
import { PostgresChatSessionRepository } from './postgres-chat-session-repository.js';
import {
  heddleChatSessionArchiveHeads,
  heddleChatSessionArchives,
  heddleChatSessions,
  postgresStorageSchema,
} from './schema.js';

const controlPool = new Pool({
  connectionString: POSTGRES_REFERENCE_DATABASE_URL,
  application_name: 'heddle-postgres-reference-verify',
});
const controlDatabase = drizzle({ client: controlPool, schema: postgresStorageSchema });

try {
  await migratePostgresStorage(controlDatabase);
  await verifySessionRepositoryConformance(controlDatabase);
  await verifyArchiveRepository(controlDatabase);
  await verifyFreshServiceRecovery(controlDatabase);
  console.log('PostgreSQL + Drizzle reference verification passed.');
} finally {
  await controlPool.end();
}

async function verifySessionRepositoryConformance(
  database: PostgresStorageDatabase,
): Promise<void> {
  const harness: ChatSessionRepositoryConformanceHarness = {
    createRepository: (scopeId) => new PostgresChatSessionRepository({
      database,
      scopeId,
    }),
    cleanupScope: async (scopeId) => await cleanupScopes(database, [scopeId]),
    corruptSessionRecord: async ({ scopeId, sessionId }) => {
      const changed = await database
        .update(heddleChatSessions)
        .set({ session: { id: sessionId, malformed: true } })
        .where(and(
          eq(heddleChatSessions.scopeId, scopeId),
          eq(heddleChatSessions.id, sessionId),
        ))
        .returning({ id: heddleChatSessions.id });
      assert.equal(changed.length, 1, 'the conformance corruption hook must change one row');
    },
  };

  await ChatSessionRepositoryConformance.runAll(harness);
}

async function verifyArchiveRepository(
  database: PostgresStorageDatabase,
): Promise<void> {
  const harness: ChatArchiveRepositoryConformanceHarness = {
    createRepository: (scopeId) => new PostgresChatArchiveRepository({
      database,
      scopeId,
    }),
    cleanupScope: async (scopeId) => await cleanupScopes(database, [scopeId]),
    corruptManifest: async ({ scopeId, sessionId }) => {
      const changed = await database
        .update(heddleChatSessionArchiveHeads)
        .set({
          manifest: {
            version: 1,
            sessionId: 'wrong-session',
            archives: [],
          },
        })
        .where(and(
          eq(heddleChatSessionArchiveHeads.scopeId, scopeId),
          eq(heddleChatSessionArchiveHeads.sessionId, sessionId),
        ))
        .returning({ sessionId: heddleChatSessionArchiveHeads.sessionId });
      assert.equal(changed.length, 1, 'the conformance corruption hook must change one row');
    },
  };

  await ChatArchiveRepositoryConformance.runAll(harness);
}

async function verifyFreshServiceRecovery(
  controlDatabase: PostgresStorageDatabase,
): Promise<void> {
  const scopeId = `recovery-${randomUUID()}`;
  const otherScopeId = `recovery-other-${randomUUID()}`;
  const sessionId = `postgres-recovery-${randomUUID()}`;
  const firstStateRoot = await mkdtemp(join(tmpdir(), 'heddle-postgres-a-'));
  const secondStateRoot = await mkdtemp(join(tmpdir(), 'heddle-postgres-b-'));
  const archiveInput = createArchiveInput(
    sessionId,
    'archive-1',
    'The host bound both repositories to one trusted scope.',
  );

  try {
    const firstPool = new Pool({
      connectionString: POSTGRES_REFERENCE_DATABASE_URL,
      application_name: 'heddle-postgres-reference-first-service',
    });
    let expectedSession;
    let expectedManifest;
    let summaryLocator: string;
    try {
      const firstDatabase = drizzle({ client: firstPool, schema: postgresStorageSchema });
      const sessionRepository = new PostgresChatSessionRepository({
        database: firstDatabase,
        scopeId,
      });
      const archiveRepository = new PostgresChatArchiveRepository({
        database: firstDatabase,
        scopeId,
      });
      const engine = createConversationEngine({
        workspaceRoot: process.cwd(),
        stateRoot: firstStateRoot,
        model: 'gpt-5.4',
        memoryMaintenanceMode: 'none',
        persistence: {
          conversations: {
            sessions: sessionRepository,
            archives: archiveRepository,
          },
        },
      });

      const created = await engine.sessions.create({
        id: sessionId,
        name: 'PostgreSQL recovery reference',
        workspaceId: 'postgres-reference',
      });
      const appended = await archiveRepository.append(archiveInput);
      const stored = await sessionRepository.read(sessionId);
      assert.ok(stored, 'the first service must persist the created session');
      const updated = await sessionRepository.update({
        expectedRevision: stored.revision,
        session: {
          ...created,
          archives: appended.manifest.archives,
          context: {
            ...created.context,
            estimatedHistoryTokens: created.context?.estimatedHistoryTokens ?? 0,
            archive: {
              count: appended.manifest.archives.length,
              currentSummaryPath: appended.manifest.currentSummaryPath,
              lastArchivePath: appended.archive.path,
            },
          },
        },
      });
      assert.ok(updated, 'the first service must persist archive references in the session');
      expectedSession = updated.session;
      expectedManifest = appended.manifest;
      summaryLocator = appended.archive.summaryPath;
    } finally {
      await firstPool.end();
    }

    const secondPool = new Pool({
      connectionString: POSTGRES_REFERENCE_DATABASE_URL,
      application_name: 'heddle-postgres-reference-second-service',
    });
    try {
      const secondDatabase = drizzle({ client: secondPool, schema: postgresStorageSchema });
      const sessionRepository = new PostgresChatSessionRepository({
        database: secondDatabase,
        scopeId,
      });
      const archiveRepository = new PostgresChatArchiveRepository({
        database: secondDatabase,
        scopeId,
      });
      const engine = createConversationEngine({
        workspaceRoot: process.cwd(),
        stateRoot: secondStateRoot,
        model: 'gpt-5.4',
        memoryMaintenanceMode: 'none',
        persistence: {
          conversations: {
            sessions: sessionRepository,
            archives: archiveRepository,
          },
        },
      });

      assert.deepEqual(
        await engine.sessions.readExisting(sessionId),
        expectedSession,
        'a fresh engine and connection pool must recover the complete session',
      );
      assert.deepEqual(
        await archiveRepository.loadManifest(sessionId),
        expectedManifest,
        'a fresh archive repository must recover the manifest',
      );
      assert.equal(
        await archiveRepository.readSummary(summaryLocator),
        archiveInput.summary,
        'a fresh archive repository must resolve the rolling summary',
      );

      const otherArchiveRepository = new PostgresChatArchiveRepository({
        database: secondDatabase,
        scopeId: otherScopeId,
      });
      const other = await otherArchiveRepository.append({
        ...archiveInput,
        summary: 'A different trusted scope owns this summary.',
      });
      assert.equal(
        other.archive.summaryPath,
        summaryLocator,
        'opaque locators may match because authorization comes from the bound repository',
      );
      assert.equal(
        await archiveRepository.readSummary(summaryLocator),
        archiveInput.summary,
        'the first repository must remain within its trusted scope',
      );
      assert.equal(
        await otherArchiveRepository.readSummary(summaryLocator),
        'A different trusted scope owns this summary.',
        'the second repository must see only its own same-address record',
      );
    } finally {
      await secondPool.end();
    }
  } finally {
    await cleanupScopes(controlDatabase, [scopeId, otherScopeId]);
    await Promise.all([
      rm(firstStateRoot, { recursive: true, force: true }),
      rm(secondStateRoot, { recursive: true, force: true }),
    ]);
  }
}

async function cleanupScopes(
  database: PostgresStorageDatabase,
  scopeIds: string[],
): Promise<void> {
  await database.transaction(async (transaction) => {
    await transaction
      .delete(heddleChatSessionArchiveHeads)
      .where(inArray(heddleChatSessionArchiveHeads.scopeId, scopeIds));
    await transaction
      .delete(heddleChatSessionArchives)
      .where(inArray(heddleChatSessionArchives.scopeId, scopeIds));
    await transaction
      .delete(heddleChatSessions)
      .where(inArray(heddleChatSessions.scopeId, scopeIds));
  });
}

function createArchiveInput(
  sessionId: string,
  archiveId: string,
  summary: string,
): AppendChatArchiveInput {
  return {
    sessionId,
    archive: {
      id: archiveId,
      shortDescription: 'PostgreSQL reference archive',
      messageCount: 2,
      createdAt: '2026-07-17T00:00:00.000Z',
      summaryModel: 'reference-no-model-call',
    },
    messages: [
      { role: 'user', content: 'Remember the durable storage boundary.' },
      { role: 'assistant', content: 'The session and archive stores share one trusted scope.' },
    ],
    summary,
  };
}
