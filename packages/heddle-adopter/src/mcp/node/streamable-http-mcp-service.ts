import type { IncomingMessage, ServerResponse } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  StreamableHTTPServerTransport,
} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { McpCapabilityUnavailableError } from '../errors.js';
import type { VerifiedMcpCapability } from '../types.js';
import type {
  NodeStreamableHttpMcpServiceConfig,
} from './types.js';

const DEFAULT_MAX_BODY_BYTES = 64 * 1_024;
const MAX_CAPABILITY_CHARACTERS = 4_096;
const REDACTED_HEADER_VALUE = '[REDACTED]';

type ActiveMcpRequest = {
  abortController: AbortController;
  request: IncomingMessage;
  response: ServerResponse;
  server?: McpServer;
  transport?: StreamableHTTPServerTransport;
  closing?: Promise<void>;
};

class McpRequestBodyError extends Error {
  constructor(readonly statusCode: 400 | 413 | 415) {
    super('Invalid MCP request body.');
  }
}

/**
 * Stateless official-SDK Streamable HTTP edge for adopter-owned MCP tools.
 *
 * Every request verifies the capability independently and owns fresh SDK
 * resources. The injected toolset remains the sole owner of model-visible
 * names, schemas, descriptions, and product operations.
 */
export class NodeStreamableHttpMcpService<TTool extends string> {
  readonly #capabilityVerifier: NodeStreamableHttpMcpServiceConfig<TTool>[
    'capabilityVerifier'
  ];
  readonly #toolset: NodeStreamableHttpMcpServiceConfig<TTool>['toolset'];
  readonly #maxBodyBytes: number;
  readonly #activeRequests = new Set<ActiveMcpRequest>();
  #closed = false;
  #closePromise: Promise<void> | undefined;

  constructor(config: NodeStreamableHttpMcpServiceConfig<TTool>) {
    this.#capabilityVerifier = config.capabilityVerifier;
    this.#toolset = config.toolset;
    this.#maxBodyBytes = z.number().int().min(1).max(1_048_576).parse(
      config.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES,
    );
  }

  /** Handles one authenticated stateless MCP request at an adopter-owned path. */
  async handle(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Vary', 'Authorization');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (this.#closed) {
      request.resume();
      writeJsonRpcError(response, 503, 'MCP service is unavailable.');
      return;
    }
    if (request.method !== 'POST') {
      request.resume();
      writeJsonRpcError(response, 405, 'Method not allowed.');
      return;
    }

    const assertion = takeBearer(request);
    if (!assertion) {
      request.resume();
      writeJsonRpcError(response, 401, 'Authentication is required.', {
        'WWW-Authenticate': 'Bearer',
      });
      return;
    }

    const active: ActiveMcpRequest = {
      abortController: new AbortController(),
      request,
      response,
    };
    const cleanup = () => void this.#closeRequest(active);
    request.once('aborted', cleanup);
    response.once('close', cleanup);
    this.#activeRequests.add(active);

    try {
      const capability = await this.#verifyCapability(assertion, response);
      if (!capability) {
        request.resume();
        return;
      }

      let body: unknown;
      try {
        body = await readJsonBody(
          request,
          this.#maxBodyBytes,
          active.abortController.signal,
        );
      } catch (error) {
        const statusCode = error instanceof McpRequestBodyError
          ? error.statusCode
          : 400;
        writeJsonRpcError(response, statusCode, 'Invalid MCP request.');
        return;
      }

      active.server = new McpServer(this.#toolset.serverInfo);
      active.transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      this.#toolset.registerAllowedTools({
        server: active.server,
        capability,
        requestSignal: active.abortController.signal,
      });
      await active.server.connect(active.transport);
      await active.transport.handleRequest(request, response, body);
    } catch {
      if (!response.headersSent && !response.destroyed) {
        writeJsonRpcError(response, 500, 'MCP request failed.');
      }
    } finally {
      request.removeListener('aborted', cleanup);
      response.removeListener('close', cleanup);
      await this.#closeRequest(active);
    }
  }

  /** Aborts active tools and closes their official SDK resources. */
  close(): Promise<void> {
    if (!this.#closePromise) {
      this.#closed = true;
      this.#closePromise = Promise.all(
        [...this.#activeRequests].map((request) => this.#closeRequest(
          request,
          true,
        )),
      ).then(() => undefined);
    }
    return this.#closePromise;
  }

  async #verifyCapability(
    assertion: string,
    response: ServerResponse,
  ): Promise<VerifiedMcpCapability<TTool> | undefined> {
    try {
      return await this.#capabilityVerifier.verify(assertion);
    } catch (error) {
      if (error instanceof McpCapabilityUnavailableError) {
        writeJsonRpcError(
          response,
          503,
          'Authentication is temporarily unavailable.',
          { 'Retry-After': '1' },
        );
        return undefined;
      }
      writeJsonRpcError(response, 401, 'Authentication failed.', {
        'WWW-Authenticate': 'Bearer error="invalid_token"',
      });
      return undefined;
    }
  }

  #closeRequest(
    resources: ActiveMcpRequest,
    destroyIo = false,
  ): Promise<void> {
    resources.abortController.abort(
      new Error('The owning MCP HTTP request closed.'),
    );
    if (destroyIo) {
      resources.request.destroy();
      resources.response.destroy();
    }
    resources.closing ??= Promise.all([
      resources.transport?.close().catch(() => undefined),
      resources.server?.close().catch(() => undefined),
    ]).then(() => {
      this.#activeRequests.delete(resources);
    });
    return resources.closing;
  }
}

function takeBearer(request: IncomingMessage): string | undefined {
  const occurrences = request.rawHeaders.reduce(
    (count, headerName, index) => count
      + (index % 2 === 0 && headerName.toLowerCase() === 'authorization' ? 1 : 0),
    0,
  );
  const value = request.headers.authorization;
  request.headers.authorization = value === undefined
    ? undefined
    : REDACTED_HEADER_VALUE;
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index]?.toLowerCase() === 'authorization') {
      request.rawHeaders[index + 1] = REDACTED_HEADER_VALUE;
    }
  }
  if (occurrences !== 1 || Array.isArray(value)) {
    return undefined;
  }
  const match = /^Bearer ([^\s]+)$/i.exec(value?.trim() ?? '');
  const assertion = match?.[1];
  return assertion
    && assertion.length <= MAX_CAPABILITY_CHARACTERS
    && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(assertion)
    ? assertion
    : undefined;
}

async function readJsonBody(
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
    throw new McpRequestBodyError(415);
  }
  const contentLength = request.headers['content-length'];
  if (contentLength !== undefined) {
    const declaredLength = Number(contentLength);
    if (!Number.isSafeInteger(declaredLength) || declaredLength < 0) {
      request.resume();
      throw new McpRequestBodyError(400);
    }
    if (declaredLength > maxBodyBytes) {
      request.resume();
      throw new McpRequestBodyError(413);
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
      throw new McpRequestBodyError(413);
    }
    chunks.push(buffer);
  }
  if (!request.complete || receivedBytes === 0) {
    throw new McpRequestBodyError(400);
  }
  try {
    return JSON.parse(
      Buffer.concat(chunks, receivedBytes).toString('utf8'),
    ) as unknown;
  } catch {
    throw new McpRequestBodyError(400);
  }
}

function writeJsonRpcError(
  response: ServerResponse,
  statusCode: number,
  message: string,
  headers: Record<string, string> = {},
): void {
  if (response.headersSent || response.destroyed) {
    return;
  }
  const body = JSON.stringify({
    jsonrpc: '2.0',
    error: { code: -32_000, message },
    id: null,
  });
  response.writeHead(statusCode, {
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  response.end(body);
}
