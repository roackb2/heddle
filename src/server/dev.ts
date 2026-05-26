import { resolve } from 'node:path';
import { listenHeddleDaemon } from './index.js';
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

await listenHeddleDaemon({
  host,
  port,
  workspaceRoot,
  stateRoot,
  logger,
  serveAssets: false,
});

function parsePort(raw: string | undefined): number | undefined {
  if (!raw) {
    return undefined;
  }
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 && value <= 65_535 ? value : undefined;
}
