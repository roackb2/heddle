/**
 * Stage 06: verify the default local conversation persistence capability.
 *
 * This script does not call a model. It writes a session and compacted archive,
 * reopens both through a fresh engine, snapshots the complete state root, and
 * verifies recovery from the restored snapshot.
 *
 * Run: yarn example:local-json-storage:verify
 * Optional: HEDDLE_EXAMPLE_STATE_ROOT=/mounted/app-data/heddle yarn example:local-json-storage:verify
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  createConversationEngine,
  type AppendChatArchiveInput,
} from '../../../src/index.js';

const workspaceRoot = process.cwd();
const configuredStateRoot = process.env.HEDDLE_EXAMPLE_STATE_ROOT?.trim();
const stateRootParent = resolve(
  configuredStateRoot
    || join(workspaceRoot, '.heddle', 'examples', 'local-json-storage'),
);
const verificationId = randomUUID();
const stateRoot = join(stateRootParent, `verification-${verificationId}`);
const sessionId = `local-json-verification-${verificationId}`;
const snapshotWorkspace = await mkdtemp(join(tmpdir(), 'heddle-local-json-snapshot-'));
const snapshotRoot = join(snapshotWorkspace, 'snapshot');
const restoredStateRoot = join(snapshotWorkspace, 'restored-state');

try {
  const firstEngine = createConversationEngine({
    workspaceRoot,
    stateRoot,
    model: 'gpt-5.4',
    memoryMaintenanceMode: 'none',
  });
  const readiness = firstEngine.persistence.conversations.readiness;

  assert.equal(readiness.source, 'default-files');
  assert.equal(readiness.targetLevel, 'local');
  assert.equal(readiness.configurationComplete, true);
  assert.deepEqual(readiness.issues, []);
  assert.deepEqual(
    readiness.requiredHostChecks.map(({ id }) => id),
    ['persistent-state-root', 'backup-and-restore'],
  );

  const created = await firstEngine.sessions.create({
    id: sessionId,
    name: 'Local JSON recovery verification',
    workspaceId: 'local-json-reference',
  });
  await firstEngine.sessions.appendMessages(sessionId, [
    { id: 'user-1', role: 'user', text: 'Remember the local durability boundary.' },
    { id: 'assistant-1', role: 'assistant', text: 'Back up and restore the complete state root.' },
  ]);
  const archiveInput: AppendChatArchiveInput = {
    sessionId,
    archive: {
      id: `archive-${verificationId}`,
      shortDescription: 'Local JSON recovery verification',
      messageCount: 2,
      createdAt: created.createdAt,
      summaryModel: 'verification-no-model-call',
    },
    messages: [
      { role: 'user', content: 'Remember the local durability boundary.' },
      { role: 'assistant', content: 'Back up and restore the complete state root.' },
    ],
    summary: 'Local durability requires the complete state root on one persistent host.\n',
  };
  const appended = await firstEngine.persistence.conversations.archives.append(archiveInput);

  // Normal turns let Heddle compaction own this linkage. The offline example
  // records it explicitly because it deliberately makes no model request.
  const expectedSession = await firstEngine.sessions.update(sessionId, (session) => ({
    ...session,
    archives: appended.manifest.archives,
    context: {
      ...session.context,
      estimatedHistoryTokens: session.context?.estimatedHistoryTokens ?? 0,
      archive: {
        count: appended.manifest.archives.length,
        currentSummaryPath: appended.manifest.currentSummaryPath,
        lastArchivePath: appended.archive.path,
      },
    },
  }));
  assert.ok(expectedSession, 'the first engine must persist the archive linkage');

  const restartedEngine = createConversationEngine({
    workspaceRoot,
    stateRoot,
    model: 'gpt-5.4',
    memoryMaintenanceMode: 'none',
  });
  assert.deepEqual(
    await restartedEngine.sessions.readExisting(sessionId),
    expectedSession,
    'a fresh engine must recover the complete session',
  );
  assert.deepEqual(
    await restartedEngine.persistence.conversations.archives.loadManifest(sessionId),
    appended.manifest,
    'a fresh engine must recover the archive manifest',
  );
  assert.equal(
    await restartedEngine.persistence.conversations.archives.readSummary(
      appended.archive.summaryPath,
    ),
    archiveInput.summary,
    'a fresh engine must resolve the rolling summary',
  );

  // There are no active writers here. Production backups must likewise stop
  // writers or use one atomic filesystem snapshot for the complete state root.
  await cp(stateRoot, snapshotRoot, { recursive: true, errorOnExist: true, force: false });
  await cp(snapshotRoot, restoredStateRoot, { recursive: true, errorOnExist: true, force: false });

  const restoredEngine = createConversationEngine({
    workspaceRoot,
    stateRoot: restoredStateRoot,
    model: 'gpt-5.4',
    memoryMaintenanceMode: 'none',
  });
  assert.deepEqual(
    await restoredEngine.sessions.readExisting(sessionId),
    expectedSession,
    'the restored state root must recover the complete session',
  );
  assert.deepEqual(
    await restoredEngine.persistence.conversations.archives.loadManifest(sessionId),
    appended.manifest,
    'the restored state root must recover the archive manifest',
  );
  assert.equal(
    await restoredEngine.persistence.conversations.archives.readSummary(
      appended.archive.summaryPath,
    ),
    archiveInput.summary,
    'the restored state root must recover the rolling summary',
  );

  console.log(JSON.stringify({
    status: 'passed',
    stateRoot,
    retainedForInspection: true,
    readiness,
    verified: [
      'fresh-engine-session-recovery',
      'fresh-engine-archive-recovery',
      'whole-state-root-backup-restore',
    ],
  }, null, 2));
} finally {
  await rm(snapshotWorkspace, { recursive: true, force: true });
}
