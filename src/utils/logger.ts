// ---------------------------------------------------------------------------
// Logger — pino-based, with pino-pretty for local development
// ---------------------------------------------------------------------------

import pino from 'pino';

/**
 * Create a Heddle logger.
 * Uses pino-pretty transport when `pretty` is true (intended for local dev).
 */
export function createLogger(options: { pretty?: boolean; level?: string } = {}): pino.Logger {
  const level = options.level ?? 'info';
  const pretty = options.pretty ?? process.env.NODE_ENV !== 'production';

  if (pretty) {
    return pino({
      level,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss.l',
          ignore: 'pid,hostname',
        },
      },
    });
  }

  return pino({ level });
}

/**
 * Default logger instance.
 */
export const logger = createLogger();
