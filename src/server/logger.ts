import { resolve } from 'node:path';
import { createLogger } from '../core/utils/logger.js';

export function createServerLogger(options: {
  stateRoot: string;
  logFilePath?: string;
  level?: string;
  pretty?: boolean;
  console?: boolean;
}) {
  return createLogger({
    level: options.level ?? process.env.HEDDLE_LOG_LEVEL ?? process.env.LOG_LEVEL ?? 'info',
    pretty: options.pretty ?? process.env.NODE_ENV !== 'production',
    console: options.console ?? true,
    logFilePath: options.logFilePath ?? resolve(options.stateRoot, 'logs', 'server.log'),
  });
}
