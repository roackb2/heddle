import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createExecutionHostClientReleaseMetadata } from './execution-host-client-release-state.mjs';

const repositoryDirectory = fileURLToPath(new URL('../', import.meta.url));
const repository = 'roackb2/heddle';

function finalizeExecutionHostClientRelease() {
  assert.equal(
    process.env.GITHUB_ACTIONS,
    'true',
    'GitHub release finalization runs only inside GitHub Actions.',
  );
  assert.equal(process.env.GITHUB_REPOSITORY, repository);
  assert.equal(process.env.GITHUB_REF, 'refs/heads/main');
  assert.ok(process.env.GH_TOKEN, 'GitHub release finalization needs GH_TOKEN.');

  const packageJson = JSON.parse(
    readFileSync(
      resolve(
        repositoryDirectory,
        'packages/execution-host-client/package.json',
      ),
      'utf8',
    ),
  );
  const release = createExecutionHostClientReleaseMetadata(packageJson);
  const head = run(
    'git',
    ['rev-parse', 'HEAD'],
    repositoryDirectory,
  ).stdout.trim();
  assert.equal(
    run(
      'git',
      ['rev-list', '-n', '1', release.releaseTag],
      repositoryDirectory,
    ).stdout.trim(),
    head,
    `Release tag ${release.releaseTag} must identify the published commit.`,
  );
  assert.equal(
    run(
      'git',
      ['cat-file', '-t', `refs/tags/${release.releaseTag}`],
      repositoryDirectory,
    ).stdout.trim(),
    'tag',
    `Release tag ${release.releaseTag} must be annotated.`,
  );

  const existing = runResult(
    'gh',
    [
      'release',
      'view',
      release.releaseTag,
      '--repo',
      repository,
      '--json',
      'isPrerelease,name,tagName,url',
    ],
    repositoryDirectory,
  );
  if (existing.status === 0) {
    assertRelease(JSON.parse(existing.stdout), release);
    process.stdout.write(
      `Verified existing GitHub release ${release.releaseTag}.\n`,
    );
    return;
  }

  assert.match(
    `${existing.stdout}\n${existing.stderr}`,
    /release not found/i,
    'GitHub release lookup failed for a reason other than an absent release.',
  );
  const createArgs = [
    'release',
    'create',
    release.releaseTag,
    '--repo',
    repository,
    '--title',
    release.releaseTitle,
    '--notes-file',
    release.releaseNote,
    '--verify-tag',
  ];
  run('gh', createArgs, repositoryDirectory);

  const created = JSON.parse(
    run(
      'gh',
      [
        'release',
        'view',
        release.releaseTag,
        '--repo',
        repository,
        '--json',
        'isPrerelease,name,tagName,url',
      ],
      repositoryDirectory,
    ).stdout,
  );
  assertRelease(created, release);
  process.stdout.write(`Created GitHub release ${created.url}.\n`);
}

function assertRelease(actual, expected) {
  assert.equal(actual.tagName, expected.releaseTag);
  assert.equal(actual.name, expected.releaseTitle);
  assert.equal(actual.isPrerelease, false);
  assert.match(actual.url, /^https:\/\/github\.com\/roackb2\/heddle\/releases\//);
}

function run(command, args, cwd) {
  const result = runResult(command, args, cwd);
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed in ${cwd}:\n${result.stdout}\n${result.stderr}`,
    );
  }
  return result;
}

function runResult(command, args, cwd) {
  return spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: process.env,
  });
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  assert.deepEqual(
    process.argv.slice(2),
    [],
    'The release finalizer accepts no arguments.',
  );
  finalizeExecutionHostClientRelease();
}
