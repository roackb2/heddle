import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { resolve } from 'node:path';

const repoRoot = resolve(new URL('..', import.meta.url).pathname);
const playwrightBin = resolve(repoRoot, 'node_modules/.bin/playwright');
const args = process.argv.slice(2);
const target = process.env.HEDDLE_BROWSER_INTEGRATION_TARGET ?? inferTarget(args);

const clientPort = process.env.HEDDLE_BROWSER_INTEGRATION_CLIENT_PORT ?? await findAvailablePort(15_174);
const clientV2Port = process.env.HEDDLE_BROWSER_INTEGRATION_CLIENT_V2_PORT ?? await findAvailablePort(Number(clientPort) + 1);
const serverPort = process.env.HEDDLE_BROWSER_INTEGRATION_SERVER_PORT ?? await findAvailablePort(19_876);

const child = spawn(playwrightBin, ['test', ...args], {
  cwd: repoRoot,
  env: {
    ...process.env,
    HEDDLE_BROWSER_INTEGRATION_CLIENT_PORT: String(clientPort),
    HEDDLE_BROWSER_INTEGRATION_CLIENT_V2_PORT: String(clientV2Port),
    HEDDLE_BROWSER_INTEGRATION_SERVER_PORT: String(serverPort),
    ...(target ? { HEDDLE_BROWSER_INTEGRATION_TARGET: target } : {}),
  },
  stdio: 'inherit',
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});

async function findAvailablePort(start) {
  for (let port = start; port < start + 200; port += 1) {
    if (await canListen(port)) {
      return String(port);
    }
  }
  throw new Error(`No available browser integration port found near ${start}`);
}

function canListen(port) {
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
    server.listen(port, '127.0.0.1');
  });
}

function inferTarget(args) {
  const projectIndex = args.findIndex((arg) => arg === '--project' || arg === '-p');
  const project = projectIndex >= 0 ? args[projectIndex + 1] : args.find((arg) => arg.startsWith('--project='));
  const projectName = project?.startsWith('--project=') ? project.slice('--project='.length) : project;
  if (projectName?.startsWith('web-v1')) {
    return 'web-v1';
  }
  if (projectName?.startsWith('web-v2')) {
    return 'web-v2';
  }
  return undefined;
}
