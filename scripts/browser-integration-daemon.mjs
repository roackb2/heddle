#!/usr/bin/env node

import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixtureRoot = resolve(repoRoot, '.browser-integration');
const homeRoot = join(fixtureRoot, 'home');
const workspacesRoot = join(fixtureRoot, 'workspaces');
const primaryWorkspace = join(workspacesRoot, 'primary');
const secondaryWorkspace = join(workspacesRoot, 'secondary');

prepareFixtureWorkspace(primaryWorkspace, {
  name: 'Primary Browser Integration Workspace',
  extraReadmeLine: 'This line is an uncommitted browser integration change.',
});
seedHeartbeatFixture(primaryWorkspace);
seedMemoryFixture(primaryWorkspace);
prepareFixtureWorkspace(secondaryWorkspace, {
  name: 'Secondary Browser Integration Workspace',
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
    process.env.HEDDLE_BROWSER_INTEGRATION_SERVER_PORT ?? '9876',
  ],
  {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOME: homeRoot,
      HEDDLE_BROWSER_INTEGRATION_PRIMARY_WORKSPACE: primaryWorkspace,
      HEDDLE_BROWSER_INTEGRATION_SECONDARY_WORKSPACE: secondaryWorkspace,
      HEDDLE_BROWSER_INTEGRATION_FAKE_AGENT: '1',
      HEDDLE_BROWSER_INTEGRATION_FAKE_STREAM_PREVIEW_MS:
        process.env.HEDDLE_BROWSER_INTEGRATION_FAKE_STREAM_PREVIEW_MS ?? '5000',
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
    `# ${options.name}\n\nThis workspace is used by Heddle browser integration tests.\n`,
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
    'user.name=Heddle Browser Integration',
    '-c',
    'user.email=heddle-browser-integration@example.com',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-m',
    'Initial fixture',
  ]);

  if (options.extraReadmeLine) {
    writeFileSync(
      join(workspaceRoot, 'README.md'),
      `# ${options.name}\n\nThis workspace is used by Heddle browser integration tests.\n\n${options.extraReadmeLine}\n`,
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

function seedHeartbeatFixture(workspaceRoot) {
  const task = {
    id: 'browser-heartbeat',
    workspaceId: 'primary',
    name: 'Browser heartbeat',
    task: 'Check browser integration heartbeat state.',
    enabled: true,
    schedule: {
      intervalMs: 3600000,
      nextRunAt: '2026-04-14T01:00:00.000Z',
    },
    state: {
      status: 'waiting',
      progress: 'Heartbeat wake finished. Waiting until the next scheduled run in 1h.',
      runId: 'browser-run-1',
      runAt: '2026-04-14T00:00:00.000Z',
      loadedCheckpoint: true,
      resumable: true,
      result: createHeartbeatResult(),
      updatedAt: '2026-04-14T00:00:00.000Z',
    },
  };
  const heartbeatRoot = join(workspaceRoot, '.heddle', 'heartbeat');
  mkdirSync(join(heartbeatRoot, 'tasks'), { recursive: true });
  mkdirSync(join(heartbeatRoot, 'runs'), { recursive: true });
  writeFileSync(join(heartbeatRoot, 'tasks', `${task.id}.json`), `${JSON.stringify(task, null, 2)}\n`, 'utf8');
  writeFileSync(
    join(heartbeatRoot, 'runs', '2026-04-14T00-00-00.000Z-browser-heartbeat.json'),
    `${JSON.stringify({
      task,
      result: createHeartbeatResult(),
      loadedCheckpoint: true,
    }, null, 2)}\n`,
    'utf8',
  );
}

function seedMemoryFixture(workspaceRoot) {
  const memoryRoot = join(workspaceRoot, '.heddle', 'memory');
  const maintenanceRoot = join(memoryRoot, '_maintenance');
  const categories = [
    'current-state',
    'workflows',
    'preferences',
    'domain',
    'operations',
    'relationships',
    'history',
  ];

  mkdirSync(maintenanceRoot, { recursive: true });
  writeFileSync(
    join(memoryRoot, 'README.md'),
    '# Workspace Memory\n\n- [Current State](current-state/README.md): Browser integration memory fixture.\n',
    'utf8',
  );

  for (const category of categories) {
    mkdirSync(join(memoryRoot, category), { recursive: true });
    writeFileSync(join(memoryRoot, category, 'README.md'), `# ${category}\n\nFixture catalog.\n`, 'utf8');
  }

  writeFileSync(
    join(memoryRoot, 'current-state', 'browser-memory.md'),
    '# Browser Memory\n\nThis note makes the memory settings page deterministic.\n',
    'utf8',
  );
  writeFileSync(
    join(memoryRoot, 'operations', 'verification.md'),
    '# Verification\n\nBrowser integration verifies memory status.\n',
    'utf8',
  );
  writeFileSync(
    join(maintenanceRoot, 'candidates.jsonl'),
    `${JSON.stringify({
      id: 'browser-memory-candidate',
      recordedAt: '2026-04-14T00:00:00.000Z',
      status: 'pending',
      summary: 'Browser memory candidate.',
    })}\n`,
    'utf8',
  );
  writeFileSync(
    join(maintenanceRoot, 'runs.jsonl'),
    `${JSON.stringify({
      id: 'memory-run-browser',
      startedAt: '2026-04-14T00:00:00.000Z',
      finishedAt: '2026-04-14T00:00:01.000Z',
      source: 'browser-integration',
      outcome: 'done',
      summary: 'Browser memory maintenance completed.',
      candidateIds: ['browser-memory-candidate'],
      processedCandidateIds: ['browser-memory-candidate'],
      failedCandidateIds: [],
      catalogValid: true,
      catalogMissing: [],
    })}\n`,
    'utf8',
  );
}

function createHeartbeatResult() {
  const state = {
    status: 'finished',
    runId: 'browser-run-1',
    goal: 'Heartbeat browser integration fixture.',
    model: 'gpt-5.1-codex-mini',
    provider: 'openai',
    workspaceRoot: primaryWorkspace,
    startedAt: '2026-04-13T23:59:00.000Z',
    finishedAt: '2026-04-14T00:00:00.000Z',
    outcome: 'done',
    summary: 'Browser heartbeat completed.',
    usage: {
      inputTokens: 12,
      outputTokens: 6,
      totalTokens: 18,
      requests: 1,
    },
    transcript: [],
    trace: [],
  };

  return {
    decision: 'continue',
    summary: 'Browser heartbeat completed.',
    checkpoint: {
      version: 1,
      runId: 'browser-run-1',
      createdAt: '2026-04-14T00:00:00.000Z',
      state,
    },
    state,
  };
}
