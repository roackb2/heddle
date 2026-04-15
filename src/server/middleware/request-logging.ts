import type { NextFunction, Request, Response } from 'express';
import type { Logger } from 'pino';

export function createRequestLoggingMiddleware(logger: Logger) {
  return (request: Request, response: Response, next: NextFunction) => {
    const startedAt = Date.now();
    response.once('finish', () => {
      logger.info({
        method: request.method,
        path: request.originalUrl,
        statusCode: response.statusCode,
        durationMs: Date.now() - startedAt,
      }, 'HTTP request');
    });
    next();
  };
}
