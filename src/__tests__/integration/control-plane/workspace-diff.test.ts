import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { ensureWorkspaceCatalog } from '../../../core/runtime/workspaces.js';
import { controlPlaneRouter } from '../../../server/features/control-plane/router.js';
import { readWorkspaceChanges, readWorkspaceFileDiff } from '../../../server/features/control-plane/services/workspace-diff.js';

describe('workspace diff review', () => {
  it('returns an empty non-git result outside a git workspace', async () => {
    const root = mkdtempSync(join(tmpdir(), 'heddle-workspace-diff-non-git-'));

    await expect(readWorkspaceChanges(root)).resolves.toEqual({
      vcs: 'none',
      clean: true,
      files: [],
      error: 'Not a git workspace.',
    });
  });

  it('reports a clean git workspace', async () => {
    const root = createGitWorkspace();

    await expect(readWorkspaceChanges(root)).resolves.toEqual({
      vcs: 'git',
      clean: true,
      files: [],
    });
  });

  it('reports modified files with diff stats and patch text', async () => {
    const root = createGitWorkspace();
    writeFileSync(join(root, 'README.md'), 'hello\nworld\nagain\n');
    mkdirSync(join(root, '.heddle'), { recursive: true });
    writeFileSync(join(root, '.heddle', 'workspaces.catalog.json'), '{}\n');

    const changes = await readWorkspaceChanges(root);
    expect(changes).toMatchObject({
      vcs: 'git',
      clean: false,
      files: [{
        path: 'README.md',
        status: 'modified',
        workingTreeStatus: 'M',
        additions: 1,
      }],
    });

    const diff = await readWorkspaceFileDiff(root, 'README.md');
    expect(diff.vcs).toBe('git');
    expect(diff.patch).toContain('diff --git a/README.md b/README.md');
    expect(diff.patch).toContain('+again');

    await expect(readWorkspaceFileDiff(root, '.heddle/workspaces.catalog.json')).resolves.toMatchObject({
      path: '.heddle/workspaces.catalog.json',
      error: 'Heddle runtime state is not included in workspace review.',
    });
  });

  it('reports untracked files and can render a no-index patch for them', async () => {
    const root = createGitWorkspace();
    writeFileSync(join(root, 'new-file.md'), 'new content\n');

    const changes = await readWorkspaceChanges(root);
    expect(changes.files).toEqual([expect.objectContaining({
      path: 'new-file.md',
      status: 'untracked',
    })]);

    const diff = await readWorkspaceFileDiff(root, 'new-file.md');
    expect(diff.patch).toContain('+++ b/new-file.md');
    expect(diff.patch).toContain('+new content');
  });

  it('reports deleted files and their patch text', async () => {
    const root = createGitWorkspace();
    unlinkSync(join(root, 'README.md'));

    const changes = await readWorkspaceChanges(root);
    expect(changes.files).toEqual([expect.objectContaining({
      path: 'README.md',
      status: 'deleted',
      workingTreeStatus: 'D',
      deletions: 2,
    })]);

    const diff = await readWorkspaceFileDiff(root, 'README.md');
    expect(diff.patch).toContain('diff --git a/README.md b/README.md');
    expect(diff.patch).toContain('-hello');
  });

  it('exposes workspace diff through the control-plane router', async () => {
    const root = createGitWorkspace();
    writeFileSync(join(root, 'README.md'), 'hello\nworld\nrouter\n');
    const stateRoot = join(root, '.heddle');
    const catalog = ensureWorkspaceCatalog({ workspaceRoot: root, stateRoot });
    const activeWorkspace = catalog.workspaces[0];
    if (!activeWorkspace) {
      throw new Error('expected default workspace');
    }
    const caller = controlPlaneRouter.createCaller({
      workspaceRoot: root,
      stateRoot,
      activeWorkspaceId: activeWorkspace.id,
      activeWorkspace,
      workspaces: catalog.workspaces,
      runtimeHost: null,
      logger: pino({ level: 'silent' }),
    });

    const changes = await caller.workspaceChanges();
    expect(changes.files.map((file) => file.path)).toEqual(['README.md']);

    const diff = await caller.workspaceFileDiff({ path: 'README.md' });
    expect(diff.patch).toContain('+router');
  });
});

function createGitWorkspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'heddle-workspace-diff-'));
  mkdirSync(root, { recursive: true });
  execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: root });
  writeFileSync(join(root, 'README.md'), 'hello\nworld\n');
  execFileSync('git', ['add', 'README.md'], { cwd: root });
  execFileSync('git', ['commit', '-m', 'initial'], { cwd: root, stdio: 'ignore' });
  return root;
}
