// ---------------------------------------------------------------------------
// Logger — pino-based, with pino-pretty for local development
// ---------------------------------------------------------------------------

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import pino from 'pino';
import pinoPretty from 'pino-pretty';

export type CreateLoggerOptions = {
  pretty?: boolean;
  level?: string;
  logFilePath?: string;
  console?: boolean;
};

/**
 * Create a Heddle logger.
 * Uses pino-pretty transport when `pretty` is true (intended for local dev).
 */
export function createLogger(options: CreateLoggerOptions = {}): pino.Logger {
  const level = options.level ?? 'info';
  const prettyOutput = options.pretty ?? process.env.NODE_ENV !== 'production';
  const consoleOutput = options.console ?? true;
  const streams: pino.StreamEntry[] = [];

  if (consoleOutput) {
    if (prettyOutput) {
      streams.push({
        stream: pinoPretty({
          colorize: true,
          translateTime: 'HH:MM:ss.l',
          ignore: 'pid,hostname',
        }),
      });
    } else {
      streams.push({ stream: process.stdout });
    }
  }

  if (options.logFilePath) {
    mkdirSync(dirname(options.logFilePath), { recursive: true });
    streams.push({
      stream: pino.destination({
        dest: options.logFilePath,
        sync: false,
        mkdir: true,
      }),
    });
  }

  if (streams.length === 0) {
    return pino({ level, enabled: false });
  }

  return pino({ level }, pino.multistream(streams));
}

/**
 * Default logger instance.
 */
export const logger = pino({ level: 'silent', enabled: false });
