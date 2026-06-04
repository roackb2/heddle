import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryCliV2CommandEdgeService } from '@/cli-v2/commands/memory-command.js';
import type { CliV2CommandEdgeOptions } from '@/cli-v2/commands/types.js';
import { LlmAdapterService } from '@/core/llm/index.js';
import { MemoryMaintenanceService } from '@/core/memory/maintainer.js';
import { RuntimeCredentialService } from '@/core/runtime/credentials/index.js';

describe('MemoryCliV2CommandEdgeService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('initializes memory catalogs and reports status through memory services', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-memory-command-'));
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await MemoryCliV2CommandEdgeService.run('init', commandOptions(workspaceRoot));
    await MemoryCliV2CommandEdgeService.run('status', commandOptions(workspaceRoot));

    const output = stdout.mock.calls.map(([message]) => message).join('');
    expect(output).toContain('Memory root:');
    expect(output).toContain('Created:');
    expect(output).toContain('Catalog shape: ok');
    expect(output).toContain('Pending candidates: 0');
  });

  it('formats list/read/search command output without owning note traversal policy', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-memory-command-notes-'));
    const memoryRoot = join(workspaceRoot, '.heddle', 'memory');
    const noteDir = join(memoryRoot, 'workflows');
    mkdirSync(noteDir, { recursive: true });
    writeFileSync(join(noteDir, 'release.md'), 'Release checklist\nRun yarn test\n', 'utf8');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await MemoryCliV2CommandEdgeService.run('list', commandOptions(workspaceRoot));
    await MemoryCliV2CommandEdgeService.run('read', commandOptions(workspaceRoot), { path: 'workflows/release.md' });
    await MemoryCliV2CommandEdgeService.run('search', commandOptions(workspaceRoot), { query: 'yarn test' });

    const output = stdout.mock.calls.map(([message]) => message).join('');
    expect(output).toContain('workflows/release.md');
    expect(output).toContain('Release checklist');
    expect(output).toContain('Run yarn test');
  });

  it('reports pending maintainer candidates in dry-run mode without constructing an LLM', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-memory-command-maintain-'));
    const maintenanceDir = join(workspaceRoot, '.heddle', 'memory', '_maintenance');
    mkdirSync(maintenanceDir, { recursive: true });
    writeFileSync(
      join(maintenanceDir, 'candidates.jsonl'),
      `${JSON.stringify({
        id: 'candidate-1',
        recordedAt: '2026-06-04T00:00:00.000Z',
        status: 'pending',
        summary: 'Remember the command-edge boundary.',
        evidence: [],
        categoryHint: 'architecture',
        importance: 'high',
        confidence: 'user-stated',
        sourceRefs: [],
      })}\n`,
      'utf8',
    );
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await MemoryCliV2CommandEdgeService.run('maintain', commandOptions(workspaceRoot), { dryRun: true });

    const output = stdout.mock.calls.map(([message]) => message).join('');
    expect(output).toContain('Pending candidates: 1');
    expect(output).toContain('candidate-1: Remember the command-edge boundary.');
  });

  it('allows maintainer runs to use stored credentials when no provider API key is present', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-memory-command-stored-credential-'));
    vi.spyOn(RuntimeCredentialService, 'resolveApiKeyForModel').mockReturnValue(undefined);
    vi.spyOn(RuntimeCredentialService, 'hasCredentialForModel').mockReturnValue(true);
    const createLlm = vi.spyOn(LlmAdapterService, 'create').mockReturnValue({} as ReturnType<typeof LlmAdapterService.create>);
    vi.spyOn(MemoryMaintenanceService.prototype, 'readPendingCandidates').mockResolvedValue([
      {
        id: 'candidate-1',
        recordedAt: '2026-06-04T00:00:00.000Z',
        status: 'pending',
        summary: 'Remember stored OAuth for memory maintenance.',
        evidence: [],
        categoryHint: 'architecture',
        importance: 'high',
        confidence: 'user-stated',
        sourceRefs: [],
      },
    ]);
    vi.spyOn(MemoryMaintenanceService.prototype, 'runBacklog').mockResolvedValue({
      run: {
        id: 'memory-run-test',
        startedAt: '2026-06-04T00:00:00.000Z',
        finishedAt: '2026-06-04T00:00:01.000Z',
        source: 'heddle memory maintain',
        outcome: 'done',
        summary: 'Processed stored credential candidate.',
        candidateIds: ['candidate-1'],
        processedCandidateIds: ['candidate-1'],
        failedCandidateIds: [],
        catalogValid: true,
        catalogMissing: [],
      },
    });
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await MemoryCliV2CommandEdgeService.run('maintain', commandOptions(workspaceRoot));

    expect(createLlm).toHaveBeenCalledWith({ model: 'gpt-5.4', credentials: undefined });
    const output = stdout.mock.calls.map(([message]) => message).join('');
    expect(output).toContain('Outcome: done');
    expect(output).toContain('Candidates: 1/1 processed');
  });
});

function commandOptions(workspaceRoot: string): CliV2CommandEdgeOptions {
  return {
    workspaceRoot,
    activeWorkspaceId: 'workspace-test',
    preferApiKey: false,
    stateDir: '.heddle',
    directShellApproval: 'never',
    searchIgnoreDirs: [],
    runtimeHost: { kind: 'none', registryPath: '' },
    forceOwnerConflict: false,
  };
}
