import { resolve } from 'node:path';
import { createHeddleServerApp } from './app.js';
import { createServerLogger } from './logger.js';

const host = process.env.HEDDLE_SERVER_HOST ?? '127.0.0.1';
const port = parsePort(process.env.HEDDLE_SERVER_PORT) ?? 8765;
const workspaceRoot = resolve(process.env.HEDDLE_WORKSPACE_ROOT ?? process.cwd());
const stateDir = process.env.HEDDLE_STATE_DIR ?? '.heddle';
const stateRoot = resolve(workspaceRoot, stateDir);
const logger = createServerLogger({
  stateRoot,
  logFilePath: process.env.HEDDLE_SERVER_LOG_FILE,
});

const app = createHeddleServerApp({
  workspaceRoot,
  stateRoot,
  logger,
});

const server = app.listen(port, host, () => {
  logger.info({
    host,
    port,
    workspaceRoot,
    stateRoot,
    apiPath: '/trpc',
    url: `http://${host}:${port}`,
  }, 'Heddle dev server started');
});

server.once('error', (error) => {
  logger.error({ error }, 'Heddle dev server failed');
  throw error;
});

function parsePort(raw: string | undefined): number | undefined {
  if (!raw) {
    return undefined;
  }
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 && value <= 65_535 ? value : undefined;
}
