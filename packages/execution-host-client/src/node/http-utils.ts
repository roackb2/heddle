import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';

const REDACTED_HEADER_VALUE = '[REDACTED]';
const MAX_AUTHORIZATION_CHARACTERS = 8_192;

export const NodeHttpPathSchema = z.string().min(1).max(256).regex(
  /^\/(?:[^?#\s]*)$/,
  'must be an absolute path without query, fragment, or whitespace',
);

export class NodeHttpRequestError extends Error {
  readonly name = 'NodeHttpRequestError';

  constructor(readonly statusCode: 400 | 413 | 415) {
    super('Invalid Node HTTP request.');
  }
}

export function readPathname(rawUrl: string | undefined): string | undefined {
  try {
    return new URL(rawUrl ?? '/', 'http://localhost').pathname;
  } catch {
    return undefined;
  }
}

export function takeAuthorization(
  request: IncomingMessage,
): string | undefined {
  const occurrences = request.rawHeaders.reduce(
    (count, headerName, index) => count
      + (index % 2 === 0 && headerName.toLowerCase() === 'authorization'
        ? 1
        : 0),
    0,
  );
  const raw = request.headers.authorization;
  request.headers.authorization = raw === undefined
    ? undefined
    : REDACTED_HEADER_VALUE;
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index]?.toLowerCase() === 'authorization') {
      request.rawHeaders[index + 1] = REDACTED_HEADER_VALUE;
    }
  }
  if (occurrences > 1 || Array.isArray(raw)) {
    throw new NodeHttpRequestError(400);
  }
  if (raw && raw.length > MAX_AUTHORIZATION_CHARACTERS) {
    throw new NodeHttpRequestError(400);
  }
  return raw;
}

export async function readJsonBody(
  request: IncomingMessage,
  maxBodyBytes: number,
  signal: AbortSignal,
): Promise<unknown> {
  const contentType = request.headers['content-type']
    ?.split(';', 1)[0]
    ?.trim()
    .toLowerCase();
  if (contentType !== 'application/json') {
    request.resume();
    throw new NodeHttpRequestError(415);
  }
  const contentLength = request.headers['content-length'];
  if (contentLength !== undefined) {
    const declaredLength = Number(contentLength);
    if (!Number.isSafeInteger(declaredLength) || declaredLength < 0) {
      request.resume();
      throw new NodeHttpRequestError(400);
    }
    if (declaredLength > maxBodyBytes) {
      request.resume();
      throw new NodeHttpRequestError(413);
    }
  }

  const chunks: Buffer[] = [];
  let receivedBytes = 0;
  for await (const chunk of request) {
    signal.throwIfAborted();
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    receivedBytes += buffer.byteLength;
    if (receivedBytes > maxBodyBytes) {
      request.resume();
      throw new NodeHttpRequestError(413);
    }
    chunks.push(buffer);
  }
  if (!request.complete || receivedBytes === 0) {
    throw new NodeHttpRequestError(400);
  }
  try {
    return JSON.parse(
      Buffer.concat(chunks, receivedBytes).toString('utf8'),
    ) as unknown;
  } catch {
    throw new NodeHttpRequestError(400);
  }
}

export function writeJsonError(
  response: ServerResponse,
  statusCode: number,
  message: string,
  headers: Record<string, string> = {},
): void {
  writeJson(response, statusCode, { error: { message } }, {
    'Cache-Control': 'no-store',
    ...headers,
  });
}

export function writeJson(
  response: ServerResponse,
  statusCode: number,
  value: unknown,
  headers: Record<string, string> = {},
): void {
  if (response.headersSent || response.destroyed) {
    return;
  }
  const body = JSON.stringify(value);
  response.writeHead(statusCode, {
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  response.end(body);
}

export function errorType(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown';
}
