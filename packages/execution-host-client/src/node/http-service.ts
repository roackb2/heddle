import { once } from 'node:events';
import type {
  IncomingMessage,
  ServerResponse,
} from 'node:http';
import { z } from 'zod';
import { ExecutionHostStreamEventSchema } from '../contracts/index.js';
import { ExecutionHostInvocationCancelledError } from '../http-sse/index.js';
import type {
  NodeExecutionAdopterFailure,
  NodeExecutionAdopterHttpHandler,
  NodeExecutionAdopterHttpPaths,
  NodeExecutionAdopterHttpServiceConfig,
  NodeExecutionAdopterPublicError,
} from './types.js';

export const DEFAULT_ADOPTER_JWKS_PATH = '/.well-known/jwks.json';
export const DEFAULT_ADOPTER_CONVERSATION_TURNS_PATH =
  '/hosted-execution/conversation-turns';

const DEFAULT_MAX_BODY_BYTES = 64 * 1_024;
const DEFAULT_MAX_PROMPT_CHARACTERS = 20_000;
const REDACTED_HEADER_VALUE = '[REDACTED]';
const MAX_AUTHORIZATION_CHARACTERS = 8_192;
const PathSchema = z.string().min(1).max(256).regex(
  /^\/(?:[^?#\s]*)$/,
  'must be an absolute path without query, fragment, or whitespace',
);
const PublicErrorSchema = z.object({
  statusCode: z.number().int().min(400).max(599),
  message: z.string().min(1).max(1_600),
}).strict();

type ActiveConversation = {
  abortController: AbortController;
  request: IncomingMessage;
  response: ServerResponse;
  pending: Promise<void>;
};

class AdopterHttpRequestError extends Error {
  constructor(readonly statusCode: 400 | 413 | 415) {
    super('Invalid adopter HTTP request.');
  }
}

/**
 * Standard Node HTTP edge for adopter-side JWKS and hosted conversations.
 *
 * The service owns bounded parsing, credential-header scrubbing, SSE framing,
 * disconnect cancellation, safe failures, and graceful shutdown. Product
 * authentication, authorization, identity selection, and persistence stay in
 * adopter callbacks.
 */
export class NodeExecutionAdopterHttpService<Principal>
implements NodeExecutionAdopterHttpHandler {
  readonly #authority: NodeExecutionAdopterHttpServiceConfig<Principal>[
    'authority'
  ];
  readonly #authenticator: NodeExecutionAdopterHttpServiceConfig<Principal>[
    'authenticator'
  ];
  readonly #conversations: NodeExecutionAdopterHttpServiceConfig<
    Principal
  >['conversations'];
  readonly #projectError: NodeExecutionAdopterHttpServiceConfig<Principal>[
    'projectError'
  ];
  readonly #reportFailure: NodeExecutionAdopterHttpServiceConfig<Principal>[
    'reportFailure'
  ];
  readonly #paths: Readonly<NodeExecutionAdopterHttpPaths>;
  readonly #maxBodyBytes: number;
  readonly #maxPromptCharacters: number;
  readonly #jwksMaxAgeSeconds: number;
  readonly #activeConversations = new Set<ActiveConversation>();
  #closed = false;
  #closePromise: Promise<void> | undefined;

  constructor(config: NodeExecutionAdopterHttpServiceConfig<Principal>) {
    this.#authority = config.authority;
    this.#authenticator = config.authenticator;
    this.#conversations = config.conversations;
    this.#projectError = config.projectError;
    this.#reportFailure = config.reportFailure;
    this.#paths = parsePaths(config.paths);
    this.#maxBodyBytes = z.number().int().min(1).max(1_048_576).parse(
      config.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES,
    );
    this.#maxPromptCharacters = z.number().int().min(1).max(200_000).parse(
      config.maxPromptCharacters ?? DEFAULT_MAX_PROMPT_CHARACTERS,
    );
    this.#jwksMaxAgeSeconds = z.number().int().min(0).max(86_400).parse(
      config.jwksMaxAgeSeconds ?? 60,
    );
  }

  handle(request: IncomingMessage, response: ServerResponse): boolean {
    const pathname = readPathname(request.url);
    if (pathname === this.#paths.jwks) {
      this.handleJwks(request, response);
      return true;
    }
    if (pathname === this.#paths.conversationTurns) {
      this.handleConversationTurn(request, response);
      return true;
    }
    return false;
  }

  handleJwks(request: IncomingMessage, response: ServerResponse): void {
    request.resume();
    if (this.#closed) {
      writeJsonError(response, 503, 'Hosted execution is unavailable.');
      return;
    }
    if (request.method !== 'GET') {
      writeJsonError(response, 405, 'Method not allowed.');
      return;
    }
    try {
      writeJson(response, 200, this.#authority.publicJwks(), {
        'Cache-Control': `public, max-age=${this.#jwksMaxAgeSeconds}`,
      });
    } catch (error) {
      this.#report({
        phase: 'jwks',
        errorType: errorType(error),
        streamAccepted: false,
      });
      writeJsonError(response, 500, 'Verification keys are unavailable.');
    }
  }

  handleConversationTurn(
    request: IncomingMessage,
    response: ServerResponse,
  ): void {
    if (this.#closed) {
      request.resume();
      writeJsonError(response, 503, 'Hosted execution is unavailable.');
      return;
    }

    const abortController = new AbortController();
    const abort = () => abortController.abort(
      new Error('The owning adopter HTTP request closed.'),
    );
    request.once('aborted', abort);
    response.once('close', abort);
    const active: ActiveConversation = {
      abortController,
      request,
      response,
      pending: Promise.resolve(),
    };
    active.pending = this.#serveConversation(
      request,
      response,
      abortController.signal,
    ).catch((error) => {
      this.#report({
        phase: 'conversation',
        errorType: errorType(error),
        streamAccepted: response.headersSent,
      });
      if (!response.headersSent) {
        writeJsonError(response, 500, 'Hosted execution request failed.');
      } else if (!response.destroyed && !response.writableEnded) {
        response.end();
      }
    }).finally(() => {
      request.removeListener('aborted', abort);
      response.removeListener('close', abort);
      this.#activeConversations.delete(active);
    });
    this.#activeConversations.add(active);
  }

  close(): Promise<void> {
    if (!this.#closePromise) {
      this.#closed = true;
      this.#closePromise = this.#closeActiveConversations();
    }
    return this.#closePromise;
  }

  async #closeActiveConversations(): Promise<void> {
    const active = [...this.#activeConversations];
    active.forEach(({ abortController, request, response }) => {
      abortController.abort(new Error('The adopter HTTP service is stopping.'));
      request.destroy();
      response.destroy();
    });
    await Promise.allSettled(active.map(({ pending }) => pending));
  }

  async #serveConversation(
    request: IncomingMessage,
    response: ServerResponse,
    signal: AbortSignal,
  ): Promise<void> {
    let authorization: string | undefined;
    try {
      authorization = takeAuthorization(request);
      if (request.method !== 'POST') {
        request.resume();
        writeJsonError(response, 405, 'Method not allowed.');
        return;
      }
    } catch (error) {
      request.resume();
      writeJsonError(
        response,
        error instanceof AdopterHttpRequestError ? error.statusCode : 400,
        'Invalid conversation request.',
      );
      return;
    }

    let principal: Principal | undefined;
    try {
      principal = await this.#authenticator.authenticate({
        authorization,
        remoteAddress: request.socket.remoteAddress,
        signal,
      });
    } catch (error) {
      this.#report({
        phase: 'authentication',
        errorType: errorType(error),
        streamAccepted: false,
      });
      request.resume();
      writeJsonError(response, 500, 'Authentication could not be completed.');
      return;
    }
    if (!principal) {
      request.resume();
      writeJsonError(response, 401, 'Authentication is required.', {
        'WWW-Authenticate': 'Bearer',
      });
      return;
    }

    let prompt: string;
    try {
      const body = await readJsonBody(request, this.#maxBodyBytes, signal);
      prompt = z.object({
        prompt: z.string().trim().min(1).max(this.#maxPromptCharacters),
      }).strict().parse(body).prompt;
    } catch (error) {
      const statusCode = error instanceof AdopterHttpRequestError
        ? error.statusCode
        : 400;
      writeJsonError(response, statusCode, 'Invalid conversation request.');
      return;
    }

    let streamed = false;
    try {
      for await (const rawEvent of this.#conversations.streamTurn({
        principal,
        prompt,
        signal,
      })) {
        const event = ExecutionHostStreamEventSchema.parse(rawEvent);
        if (!streamed) {
          writeEventStreamHeaders(response);
          streamed = true;
        }
        await writeSseEvent(response, event, signal);
      }
      if (!streamed) {
        writeJsonError(response, 502, 'Execution Host returned no events.');
        return;
      }
      response.end();
    } catch (error) {
      const publicError = !streamed ? this.#project(error) : undefined;
      if (publicError) {
        writeJsonError(response, publicError.statusCode, publicError.message);
        return;
      }
      if (
        error instanceof ExecutionHostInvocationCancelledError
        || signal.aborted
      ) {
        if (!response.headersSent && !response.destroyed) {
          writeJsonError(response, 499, 'Hosted conversation was cancelled.');
        }
        return;
      }
      this.#report({
        phase: 'conversation',
        errorType: errorType(error),
        streamAccepted: streamed,
      });
      if (!response.headersSent) {
        writeJsonError(response, 502, 'Execution Host conversation failed.');
      } else if (!response.destroyed && !response.writableEnded) {
        // A post-acceptance failure deliberately ends without a terminal event.
        response.end();
      }
    }
  }

  #project(error: unknown): NodeExecutionAdopterPublicError | undefined {
    if (!this.#projectError) {
      return undefined;
    }
    try {
      const projected = this.#projectError(error);
      return projected ? PublicErrorSchema.parse(projected) : undefined;
    } catch {
      return undefined;
    }
  }

  #report(failure: NodeExecutionAdopterFailure): void {
    try {
      this.#reportFailure?.(Object.freeze({ ...failure }));
    } catch {
      // Observability must not change request settlement.
    }
  }
}

function parsePaths(
  paths: Partial<NodeExecutionAdopterHttpPaths> | undefined,
): Readonly<NodeExecutionAdopterHttpPaths> {
  const parsed = {
    jwks: PathSchema.parse(paths?.jwks ?? DEFAULT_ADOPTER_JWKS_PATH),
    conversationTurns: PathSchema.parse(
      paths?.conversationTurns ?? DEFAULT_ADOPTER_CONVERSATION_TURNS_PATH,
    ),
  };
  if (parsed.jwks === parsed.conversationTurns) {
    throw new Error('Adopter HTTP paths must be distinct.');
  }
  return Object.freeze(parsed);
}

function readPathname(rawUrl: string | undefined): string | undefined {
  try {
    return new URL(rawUrl ?? '/', 'http://localhost').pathname;
  } catch {
    return undefined;
  }
}

function takeAuthorization(request: IncomingMessage): string | undefined {
  const occurrences = request.rawHeaders.reduce(
    (count, headerName, index) => count
      + (index % 2 === 0 && headerName.toLowerCase() === 'authorization' ? 1 : 0),
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
    throw new AdopterHttpRequestError(400);
  }
  if (raw && raw.length > MAX_AUTHORIZATION_CHARACTERS) {
    throw new AdopterHttpRequestError(400);
  }
  return raw;
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
    throw new AdopterHttpRequestError(415);
  }
  const contentLength = request.headers['content-length'];
  if (contentLength !== undefined) {
    const declaredLength = Number(contentLength);
    if (!Number.isSafeInteger(declaredLength) || declaredLength < 0) {
      request.resume();
      throw new AdopterHttpRequestError(400);
    }
    if (declaredLength > maxBodyBytes) {
      request.resume();
      throw new AdopterHttpRequestError(413);
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
      throw new AdopterHttpRequestError(413);
    }
    chunks.push(buffer);
  }
  if (!request.complete || receivedBytes === 0) {
    throw new AdopterHttpRequestError(400);
  }
  try {
    return JSON.parse(
      Buffer.concat(chunks, receivedBytes).toString('utf8'),
    ) as unknown;
  } catch {
    throw new AdopterHttpRequestError(400);
  }
}

function writeEventStreamHeaders(response: ServerResponse): void {
  response.writeHead(200, {
    'Cache-Control': 'no-store',
    'Content-Type': 'text/event-stream; charset=utf-8',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    'X-Content-Type-Options': 'nosniff',
  });
}

async function writeSseEvent(
  response: ServerResponse,
  event: z.infer<typeof ExecutionHostStreamEventSchema>,
  signal: AbortSignal,
): Promise<void> {
  const frame = [
    `event: ${event.kind}`,
    `id: ${event.sequence}`,
    `data: ${JSON.stringify(event)}`,
    '',
    '',
  ].join('\n');
  if (!response.write(frame)) {
    await once(response, 'drain', { signal });
  }
}

function writeJsonError(
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

function writeJson(
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

function errorType(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown';
}
