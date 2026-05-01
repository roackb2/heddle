import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { collectEvalArtifacts, parseChangedFiles } from '../../../core/eval/git-artifacts.js';

describe('parseChangedFiles', () => {
  it('combines name-status and numstat git output', () => {
    expect(parseChangedFiles({
      nameStatus: [
        'M\tsrc/app.ts',
        'A\tsrc/new.ts',
        'R100\tsrc/old.ts\tsrc/renamed.ts',
      ].join('\n'),
      numStat: [
        '4\t1\tsrc/app.ts',
        '10\t0\tsrc/new.ts',
        '2\t2\tsrc/renamed.ts',
      ].join('\n'),
      untrackedFiles: [
        {
          path: 'src/untracked.ts',
          additions: 3,
        },
      ],
    })).toEqual([
      {
        path: 'src/app.ts',
        status: 'M',
        additions: 4,
        deletions: 1,
      },
      {
        path: 'src/new.ts',
        status: 'A',
        additions: 10,
        deletions: 0,
      },
      {
        path: 'src/renamed.ts',
        status: 'R100',
        additions: 2,
        deletions: 2,
      },
      {
        path: 'src/untracked.ts',
        status: '??',
        additions: 3,
        deletions: 0,
      },
    ]);
  });
});

describe('collectEvalArtifacts', () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    for (const tempRoot of tempRoots.splice(0)) {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('includes untracked files in changed files and patch artifacts', async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'heddle-eval-git-artifacts-'));
    tempRoots.push(repoRoot);
    execFileSync('git', ['init'], { cwd: repoRoot });
    execFileSync('git', ['config', 'user.name', 'Heddle Test'], { cwd: repoRoot });
    execFileSync('git', ['config', 'user.email', 'heddle-test@example.com'], { cwd: repoRoot });
    execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: repoRoot });

    mkdirSync(join(repoRoot, 'src'), { recursive: true });
    writeFileSync(join(repoRoot, 'src', 'tracked.ts'), 'export const value = 1;\n', 'utf8');
    execFileSync('git', ['add', '.'], { cwd: repoRoot });
    execFileSync('git', ['commit', '-m', 'baseline'], { cwd: repoRoot });

    writeFileSync(join(repoRoot, 'src', 'tracked.ts'), 'export const value = 2;\n', 'utf8');
    writeFileSync(join(repoRoot, 'src', 'new-test.ts'), 'import { expect, it } from "vitest";\n\nit("works", () => expect(1).toBe(1));\n', 'utf8');

    const outputDir = mkdtempSync(join(tmpdir(), 'heddle-eval-artifacts-output-'));
    tempRoots.push(outputDir);
    const artifacts = await collectEvalArtifacts({
      workspaceRoot: repoRoot,
      outputDir,
    });

    expect(artifacts.changedFiles).toEqual([
      {
        path: 'src/tracked.ts',
        status: 'M',
        additions: 1,
        deletions: 1,
      },
      {
        path: 'src/new-test.ts',
        status: '??',
        additions: 3,
        deletions: 0,
      },
    ]);
    expect(readFileSync(artifacts.gitDiffPath, 'utf8')).toContain('src/new-test.ts');
    expect(readFileSync(artifacts.gitDiffStatPath, 'utf8')).toContain('src/new-test.ts');
  });
});
