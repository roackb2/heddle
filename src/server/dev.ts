import { resolve } from 'node:path';
import { startHeddleControlPlaneServer } from './index.js';
import { createServerLogger } from './logging/server-logger.js';

const host = process.env.HEDDLE_SERVER_HOST ?? '127.0.0.1';
const port = parsePort(process.env.HEDDLE_SERVER_PORT) ?? 8765;
const workspaceRoot = resolve(process.env.HEDDLE_WORKSPACE_ROOT ?? process.cwd());
const stateDir = process.env.HEDDLE_STATE_DIR ?? '.heddle';
const stateRoot = resolve(workspaceRoot, stateDir);
const logger = createServerLogger({
  stateRoot,
  logFilePath: process.env.HEDDLE_SERVER_LOG_FILE,
});

const server = await startHeddleControlPlaneServer({
  mode: 'daemon',
  host,
  port,
  workspaceRoot,
  stateRoot,
  logger,
  serveAssets: false,
});

process.stdout.write(`Heddle server listening at http://${server.host}:${server.port}\n`);
process.stdout.write(`workspace=${server.workspaceRoot}\n`);
process.stdout.write(`state=${server.stateRoot}\n`);
process.stdout.write(`registry=${server.registryPath}\n`);

let shuttingDown = false;
const shutdown = (signal: NodeJS.Signals) => {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  server.close()
    .catch((error) => {
      process.stderr.write(`Heddle server failed during ${signal} shutdown: ${String(error)}\n`);
      process.exitCode = 1;
    })
    .finally(() => {
      process.exit();
    });
};

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

function parsePort(raw: string | undefined): number | undefined {
  if (!raw) {
    return undefined;
  }
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 && value <= 65_535 ? value : undefined;
}
