import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { prepareEvalWorkspace } from '../../core/eval/workspace-fixture.js';
import type { AgentEvalCase } from '../../core/eval/schema.js';

describe('prepareEvalWorkspace', () => {
  it('creates an inline repository even when setup has no files', async () => {
    const workRoot = mkdtempSync(join(tmpdir(), 'heddle-inline-fixture-'));
    const testCase: AgentEvalCase = {
      id: 'empty-inline',
      kind: 'coding',
      prompt: 'Inspect the repo.',
      fixture: { type: 'inline' },
      setup: {},
      review: {
        requiredOutcomes: [],
        allowedScope: [],
        outOfScope: [],
        humanQuestions: [],
      },
      checks: [],
      rubric: [],
      tags: [],
    };

    const prepared = await prepareEvalWorkspace({
      testCase,
      repoRoot: process.cwd(),
      workRoot,
    });

    expect(existsSync(join(prepared.workspaceRoot, '.git'))).toBe(true);
    expect(prepared.fixture).toMatchObject({
      type: 'inline',
    });
    expect(prepared.fixture.baselineCommit).toMatch(/^[0-9a-f]{40}$/);
  });

  it('creates a pinned git worktree and commits setup changes as the baseline', async () => {
    const sourceRepo = createSourceRepo();
    const targetCommit = git(sourceRepo, ['rev-parse', 'HEAD']);
    const workRoot = mkdtempSync(join(tmpdir(), 'heddle-worktree-fixture-'));
    const testCase: AgentEvalCase = {
      id: 'dogfood-worktree',
      kind: 'coding',
      prompt: 'Fix the seeded test.',
      fixture: {
        type: 'git-worktree',
        repo: sourceRepo,
        ref: 'v1.0.0',
      },
      setup: {
        copyFiles: {
          'package.json': 'fixtures/copied-package.json',
        },
        files: {
          'src/seeded.test.ts': 'export const seeded = true;\n',
        },
        commitMessage: 'Seed eval test',
      },
      review: {
        requiredOutcomes: [],
        allowedScope: [],
        outOfScope: [],
        humanQuestions: [],
      },
      checks: [],
      rubric: [],
      tags: [],
    };

    const prepared = await prepareEvalWorkspace({
      testCase,
      repoRoot: process.cwd(),
      workRoot,
    });

    expect(readFileSync(join(prepared.workspaceRoot, 'src/app.ts'), 'utf8')).toBe('export const value = 1;\n');
    expect(readFileSync(join(prepared.workspaceRoot, 'src/seeded.test.ts'), 'utf8')).toBe('export const seeded = true;\n');
    expect(readFileSync(join(prepared.workspaceRoot, 'fixtures/copied-package.json'), 'utf8')).toContain('"name":');
    expect(prepared.fixture).toMatchObject({
      type: 'git-worktree',
      repo: sourceRepo,
      ref: 'v1.0.0',
      resolvedRef: targetCommit,
    });
    expect(prepared.fixture.baselineCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(prepared.fixture.baselineCommit).not.toBe(targetCommit);
    expect(git(prepared.workspaceRoot, ['status', '--porcelain'])).toBe('');
  });

  it('copies eval auth state without contaminating the measured workspace diff', async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'heddle-eval-auth-source-'));
    mkdirSync(join(repoRoot, '.heddle'), { recursive: true });
    writeFileSync(join(repoRoot, '.heddle/auth.json'), '{"provider":"openai"}\n');
    const workRoot = mkdtempSync(join(tmpdir(), 'heddle-inline-auth-fixture-'));
    const testCase: AgentEvalCase = {
      id: 'auth-inline',
      kind: 'coding',
      prompt: 'Inspect the repo.',
      fixture: { type: 'inline' },
      setup: {},
      review: {
        requiredOutcomes: [],
        allowedScope: [],
        outOfScope: [],
        humanQuestions: [],
      },
      checks: [],
      rubric: [],
      tags: [],
    };

    const prepared = await prepareEvalWorkspace({
      testCase,
      repoRoot,
      workRoot,
    });

    expect(readFileSync(join(prepared.workspaceRoot, '.heddle/auth.json'), 'utf8')).toBe('{"provider":"openai"}\n');
    expect(git(prepared.workspaceRoot, ['status', '--porcelain'])).toBe('');
  });
});

function createSourceRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), 'heddle-source-repo-'));
  mkdirSync(join(repo, 'src'), { recursive: true });
  writeFileSync(join(repo, 'src/app.ts'), 'export const value = 1;\n');
  git(repo, ['init']);
  git(repo, ['config', 'user.name', 'Heddle Eval']);
  git(repo, ['config', 'user.email', 'heddle-eval@example.com']);
  git(repo, ['config', 'commit.gpgsign', 'false']);
  git(repo, ['config', 'tag.gpgSign', 'false']);
  git(repo, ['add', '.']);
  git(repo, ['commit', '-m', 'Initial source']);
  git(repo, ['tag', 'v1.0.0']);
  return repo;
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}
