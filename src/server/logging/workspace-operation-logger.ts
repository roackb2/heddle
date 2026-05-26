import type { Logger } from 'pino';
import { resolve } from 'node:path';
import { createServerLogger } from './server-logger.js';

const workspaceLoggers = new Map<string, Logger>();

export function getWorkspaceOperationLogger(stateRoot: string): Logger {
  const resolvedStateRoot = resolve(stateRoot);
  const cached = workspaceLoggers.get(resolvedStateRoot);
  if (cached) {
    return cached;
  }

  const logger = createServerLogger({
    stateRoot: resolvedStateRoot,
    console: false,
  });
  workspaceLoggers.set(resolvedStateRoot, logger);
  return logger;
}
