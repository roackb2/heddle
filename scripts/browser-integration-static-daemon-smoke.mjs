#!/usr/bin/env node

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cliEntry = resolve(repoRoot, 'dist/src/cli-v2/main.js');
const webV2Index = resolve(repoRoot, 'dist/src/web-v2/index.html');
const fixtureRoot = resolve(repoRoot, '.browser-integration-static');
const homeRoot = join(fixtureRoot, 'home');
const workspaceRoot = join(fixtureRoot, 'workspace');
const port = process.env.HEDDLE_BROWSER_INTEGRATION_STATIC_PORT ?? await findAvailablePort(19_976);
const baseUrl = `http://127.0.0.1:${port}`;

assertBuiltArtifacts();
prepareFixtureWorkspace();

const daemon = spawn(
  'node',
  [
    cliEntry,
    '--cwd',
    workspaceRoot,
    '--force-owner-conflict',
    'daemon',
    '--host',
    '127.0.0.1',
    '--port',
    String(port),
  ],
  {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOME: homeRoot,
      HEDDLE_BROWSER_INTEGRATION_FAKE_AGENT: '1',
    },
    stdio: 'inherit',
  },
);

let browser;

try {
  await waitForServer();
  await verifyControlPlaneApi();

  browser = await chromium.launch();
  const page = await browser.newPage();

  await page.goto(`${baseUrl}/sessions`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="web-v2-surface-sessions"]', { timeout: 10_000 });
  await assertPageTitle(page);

  await page.goto(`${baseUrl}/settings/workspaces`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="web-v2-workbench-title"]', { timeout: 10_000 });
  await assertText(page, '[data-testid="web-v2-workbench-title"]', 'Workspace');
  await assertText(page, '[data-testid="web-v2-workbench-body"]', 'Current workspace');

  await page.goto(`${baseUrl}/tasks`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="web-v2-surface-tasks"]', { timeout: 10_000 });
} finally {
  await browser?.close();
  await stopDaemon();
  rmSync(fixtureRoot, { recursive: true, force: true });
}

function assertBuiltArtifacts() {
  const missing = [
    [cliEntry, 'CLI entrypoint'],
    [webV2Index, 'web v2 index'],
  ].filter(([path]) => !existsSync(path));

  if (missing.length) {
    throw new Error(`Missing built artifacts: ${missing.map(([, label]) => label).join(', ')}. Run yarn build first.`);
  }
}

function prepareFixtureWorkspace() {
  rmSync(fixtureRoot, { recursive: true, force: true });
  mkdirSync(workspaceRoot, { recursive: true });
  mkdirSync(homeRoot, { recursive: true });
  writeFileSync(
    join(workspaceRoot, 'README.md'),
    '# Static Daemon Smoke\n\nThis workspace verifies bundled web-v2 daemon assets.\n',
    'utf8',
  );
  writeFileSync(
    join(workspaceRoot, 'package.json'),
    `${JSON.stringify({ name: 'static-daemon-smoke', private: true }, null, 2)}\n`,
    'utf8',
  );

  execGit(['init']);
  execGit(['add', 'README.md', 'package.json']);
  execGit([
    '-c',
    'user.name=Heddle Static Smoke',
    '-c',
    'user.email=heddle-static-smoke@example.com',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-m',
    'Initial fixture',
  ]);
}

function execGit(args) {
  execFileSync('git', args, {
    cwd: workspaceRoot,
    stdio: 'ignore',
  });
}

async function waitForServer() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 20_000) {
    if (daemon.exitCode !== null || daemon.signalCode !== null) {
      throw new Error(`Static daemon exited before it became ready with code ${daemon.exitCode} and signal ${daemon.signalCode}.`);
    }

    try {
      const response = await fetch(`${baseUrl}/trpc/controlPlane.state?batch=1&input=%7B%7D`);
      if (response.ok) {
        return;
      }
    } catch {
      // Retry until the daemon finishes startup.
    }
    await delay(250);
  }

  throw new Error(`Timed out waiting for static daemon at ${baseUrl}.`);
}

async function verifyControlPlaneApi() {
  const response = await fetch(`${baseUrl}/trpc/controlPlane.state?batch=1&input=%7B%7D`);
  if (!response.ok) {
    throw new Error(`Control plane API returned ${response.status}.`);
  }

  const body = await response.text();
  if (!body.includes('workspaces') || !body.includes('workspace')) {
    throw new Error('Control plane API response did not include workspace state.');
  }
}

async function assertPageTitle(page) {
  const title = await page.title();
  if (title !== 'Heddle Control Plane V2') {
    throw new Error(`Expected bundled web-v2 title, got "${title}".`);
  }
}

async function assertText(page, selector, expected) {
  const text = await page.locator(selector).innerText({ timeout: 10_000 });
  if (!text.toLowerCase().includes(expected.toLowerCase())) {
    throw new Error(`Expected ${selector} to include "${expected}", got "${text}".`);
  }
}

async function stopDaemon() {
  if (daemon.exitCode !== null) {
    return;
  }

  daemon.kill('SIGTERM');
  const stopped = await Promise.race([
    new Promise((resolveStopped) => daemon.once('exit', () => resolveStopped(true))),
    delay(3000).then(() => false),
  ]);

  if (!stopped && daemon.exitCode === null) {
    daemon.kill('SIGKILL');
  }
}

async function findAvailablePort(start) {
  for (let candidate = Number(start); candidate < Number(start) + 200; candidate += 1) {
    if (await canListen(candidate)) {
      return candidate;
    }
  }
  throw new Error(`No available static daemon smoke port found near ${start}`);
}

function canListen(candidate) {
  return new Promise((resolveCanListen) => {
    const server = createServer();
    server.once('error', () => {
      resolveCanListen(false);
    });
    server.once('listening', () => {
      server.close(() => {
        resolveCanListen(true);
      });
    });
    server.listen(candidate, '127.0.0.1');
  });
}

function delay(ms) {
  return new Promise((resolveDelay) => {
    setTimeout(resolveDelay, ms);
  });
}
