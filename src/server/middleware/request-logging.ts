import type { NextFunction, Request, Response } from 'express';
import type { Logger } from 'pino';

type RequestLoggingOptions = {
  logger: Logger;
  resolveLogger?: (request: Request) => Logger;
};

export function createRequestLoggingMiddleware(options: Logger | RequestLoggingOptions) {
  const defaultLogger = isRequestLoggingOptions(options) ? options.logger : options;
  const resolveLogger = isRequestLoggingOptions(options) ? options.resolveLogger : undefined;

  return (request: Request, response: Response, next: NextFunction) => {
    const startedAt = Date.now();
    const requestLogger = resolveLogger?.(request) ?? defaultLogger;
    response.once('finish', () => {
      requestLogger.info({
        method: request.method,
        path: request.originalUrl,
        statusCode: response.statusCode,
        durationMs: Date.now() - startedAt,
      }, 'HTTP request');
    });
    next();
  };
}

function isRequestLoggingOptions(options: Logger | RequestLoggingOptions): options is RequestLoggingOptions {
  return 'logger' in options;
}
