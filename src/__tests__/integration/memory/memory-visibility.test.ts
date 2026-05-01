import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { bootstrapMemoryWorkspace } from '../../../core/memory/catalog.js';
import {
  listMemoryNotePaths,
  loadMemoryStatus,
  readMemoryNote,
  searchMemoryNotes,
} from '../../../core/memory/visibility.js';
import {
  repairMissingMemoryCatalogs,
  validateMemoryWorkspace,
} from '../../../core/memory/validation.js';
import { ensureWorkspaceCatalog } from '../../../core/runtime/workspaces.js';
import { controlPlaneRouter } from '../../../server/features/control-plane/router.js';

describe('memory visibility', () => {
  it('loads memory status, lists notes, reads notes, and searches notes', async () => {
    const memoryRoot = await mkdtemp(join(tmpdir(), 'heddle-memory-visibility-'));
    bootstrapMemoryWorkspace({ memoryRoot });
    await mkdir(join(memoryRoot, '_maintenance'), { recursive: true });
    await writeFile(join(memoryRoot, 'operations', 'verification.md'), '# Verification\n\nRun `yarn build`.\n', 'utf8');
    await writeFile(join(memoryRoot, '_maintenance', 'candidates.jsonl'), `${JSON.stringify({
      id: 'candidate-pending',
      recordedAt: '2026-04-24T00:00:00.000Z',
      status: 'pending',
      summary: 'Pending memory.',
    })}\n`, 'utf8');
    await writeFile(join(memoryRoot, '_maintenance', 'runs.jsonl'), `${JSON.stringify({
      id: 'memory-run-1',
      startedAt: '2026-04-24T00:00:00.000Z',
      finishedAt: '2026-04-24T00:00:01.000Z',
      source: 'test',
      outcome: 'done',
      summary: 'Processed memory.',
      candidateIds: ['candidate-processed'],
      processedCandidateIds: ['candidate-processed'],
      failedCandidateIds: [],
      catalogValid: true,
      catalogMissing: [],
    })}\n`, 'utf8');

    await expect(listMemoryNotePaths({ memoryRoot })).resolves.toContain('operations/verification.md');
    await expect(readMemoryNote({ memoryRoot, path: 'operations/verification.md' })).resolves.toContain('yarn build');
    await expect(searchMemoryNotes({ memoryRoot, query: 'yarn build' })).resolves.toContain('operations/verification.md');
    await expect(readMemoryNote({ memoryRoot, path: '../outside.md' })).rejects.toThrow(/must stay inside/);

    const status = await loadMemoryStatus({ memoryRoot });
    expect(status).toMatchObject({
      catalog: { ok: true },
      candidates: { pending: 1 },
      runs: { latest: [expect.objectContaining({ id: 'memory-run-1' })] },
    });
  });

  it('exposes read-only memory procedures on the control-plane router', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'heddle-memory-visibility-workspace-'));
    const stateRoot = await mkdtemp(join(tmpdir(), 'heddle-memory-visibility-state-'));
    const memoryRoot = join(stateRoot, 'memory');
    bootstrapMemoryWorkspace({ memoryRoot });
    await writeFile(join(memoryRoot, 'operations', 'verification.md'), '# Verification\n\nRun `yarn build`.\n', 'utf8');
    const catalog = ensureWorkspaceCatalog({ workspaceRoot, stateRoot });
    const activeWorkspace = catalog.workspaces[0];
    if (!activeWorkspace) {
      throw new Error('expected default workspace');
    }
    const caller = controlPlaneRouter.createCaller({
      workspaceRoot,
      stateRoot,
      activeWorkspaceId: activeWorkspace.id,
      activeWorkspace,
      workspaces: catalog.workspaces,
      runtimeHost: null,
      logger: pino({ level: 'silent' }),
    });

    await expect(caller.memoryStatus()).resolves.toMatchObject({ catalog: { ok: true } });
    await expect(caller.memoryList({})).resolves.toMatchObject({ notes: expect.arrayContaining(['operations/verification.md']) });
    await expect(caller.memoryRead({ path: 'operations/verification.md' })).resolves.toMatchObject({ content: expect.stringContaining('yarn build') });
    await expect(caller.memorySearch({ query: 'yarn build' })).resolves.toMatchObject({ matches: expect.stringContaining('operations/verification.md') });
    await expect(caller.memoryRead({ path: '../outside.md' })).rejects.toThrow(/must stay inside/);
  });

  it('validates memory quality issues and safely repairs missing catalogs', async () => {
    const memoryRoot = await mkdtemp(join(tmpdir(), 'heddle-memory-validation-'));
    bootstrapMemoryWorkspace({ memoryRoot });
    await rm(join(memoryRoot, 'operations', 'README.md'));
    await writeFile(join(memoryRoot, 'operations', 'orphan.md'), '# Orphan\n\nNo catalog link yet.\n', 'utf8');
    await writeFile(join(memoryRoot, 'README.md'), `# Workspace Memory\n\n${'A'.repeat(13 * 1024)}\n`, 'utf8');
    await mkdir(join(memoryRoot, '_maintenance'), { recursive: true });
    await writeFile(join(memoryRoot, '_maintenance', 'candidates.jsonl'), `${JSON.stringify({
      id: 'candidate-pending',
      recordedAt: '2026-04-24T00:00:00.000Z',
      status: 'pending',
      summary: 'Pending memory.',
    })}\n`, 'utf8');

    const validation = await validateMemoryWorkspace({ memoryRoot });
    expect(validation.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'missing_catalog', path: 'operations/README.md' }),
      expect.objectContaining({ type: 'oversized_catalog', path: 'README.md' }),
      expect.objectContaining({ type: 'orphan_note', path: 'operations/orphan.md' }),
      expect.objectContaining({ type: 'pending_candidates', count: 1 }),
    ]));
    expect(validation.ok).toBe(false);

    const repair = await repairMissingMemoryCatalogs({ memoryRoot });
    expect(repair.createdPaths).toContain('operations/README.md');

    const repaired = await validateMemoryWorkspace({ memoryRoot });
    expect(repaired.issues).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'missing_catalog', path: 'operations/README.md' }),
    ]));
  });
});
