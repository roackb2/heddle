#!/usr/bin/env node

import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixtureRoot = resolve(repoRoot, '.e2e');
const homeRoot = join(fixtureRoot, 'home');
const workspacesRoot = join(fixtureRoot, 'workspaces');
const primaryWorkspace = join(workspacesRoot, 'primary');
const secondaryWorkspace = join(workspacesRoot, 'secondary');

prepareFixtureWorkspace(primaryWorkspace, {
  name: 'Primary E2E Workspace',
  extraReadmeLine: 'This line is an uncommitted E2E change.',
});
prepareFixtureWorkspace(secondaryWorkspace, {
  name: 'Secondary E2E Workspace',
});
mkdirSync(homeRoot, { recursive: true });

const child = spawn(
  'yarn',
  [
    'cli:dev',
    '--cwd',
    primaryWorkspace,
    '--force-owner-conflict',
    'daemon',
    '--no-assets',
    '--host',
    '127.0.0.1',
    '--port',
    process.env.HEDDLE_E2E_SERVER_PORT ?? '9876',
  ],
  {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOME: homeRoot,
      HEDDLE_E2E_PRIMARY_WORKSPACE: primaryWorkspace,
      HEDDLE_E2E_SECONDARY_WORKSPACE: secondaryWorkspace,
      HEDDLE_E2E_FAKE_AGENT: '1',
    },
    stdio: 'inherit',
  },
);

const shutdown = (signal) => {
  child.kill(signal);
};

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));

child.once('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

function prepareFixtureWorkspace(workspaceRoot, options) {
  rmSync(workspaceRoot, { recursive: true, force: true });
  mkdirSync(workspaceRoot, { recursive: true });
  writeFileSync(
    join(workspaceRoot, 'README.md'),
    `# ${options.name}\n\nThis workspace is used by Heddle Playwright tests.\n`,
    'utf8',
  );
  writeFileSync(
    join(workspaceRoot, 'package.json'),
    `${JSON.stringify({ name: options.name.toLowerCase().replaceAll(' ', '-'), private: true }, null, 2)}\n`,
    'utf8',
  );

  execGit(workspaceRoot, ['init']);
  execGit(workspaceRoot, ['add', 'README.md', 'package.json']);
  execGit(workspaceRoot, [
    '-c',
    'user.name=Heddle E2E',
    '-c',
    'user.email=heddle-e2e@example.com',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-m',
    'Initial fixture',
  ]);

  if (options.extraReadmeLine) {
    writeFileSync(
      join(workspaceRoot, 'README.md'),
      `# ${options.name}\n\nThis workspace is used by Heddle Playwright tests.\n\n${options.extraReadmeLine}\n`,
      'utf8',
    );
  }
}

function execGit(cwd, args) {
  execFileSync('git', args, {
    cwd,
    stdio: 'ignore',
  });
}
