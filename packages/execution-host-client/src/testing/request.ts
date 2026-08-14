import {
  createHash,
  timingSafeEqual,
} from 'node:crypto';
import type {
  IncomingMessage,
  ServerResponse,
} from 'node:http';
import { z } from 'zod';
import {
  AGENTCORE_RUNTIME_SESSION_HEADER,
  EXECUTION_ASSERTION_HEADER,
  EXECUTION_HOST_LOCAL_TOKEN_HEADER,
  ExecutionHostConversationTurnRequestSchema,
  MCP_CAPABILITY_HEADER,
  MODEL_API_KEY_HEADER,
  RuntimeSessionIdSchema,
  type ExecutionHostConversationTurnRequest,
} from '../contracts/index.js';

const MAX_REQUEST_BODY_BYTES = 262_144;
const REDACTED_HEADER_VALUE = '[REDACTED]';
const SecretSchema = z.string().min(8).max(4_096);
const AssertionSchema = z.string().min(32).max(4_096);
const ErrorCodeSchema = z.string().min(1).max(128).regex(/^[a-z0-9_]+$/);

export type ParsedLocalExecutionHostRequest = {
  request: ExecutionHostConversationTurnRequest;
  runtimeSessionId: string;
  mcpCapability?: string;
};

export async function parseLocalExecutionHostRequest(
  request: IncomingMessage,
  expectedLocalToken: string,
  signal: AbortSignal,
): Promise<ParsedLocalExecutionHostRequest> {
  const headers = takeInvocationHeaders(request);
  assertInvocationRoute(request);
  assertLocalToken(headers.localToken, expectedLocalToken);
  const runtimeSessionId = parseRequestValue(
    RuntimeSessionIdSchema,
    headers.runtimeSessionId,
    400,
    'invalid_runtime_session',
  );
  parseRequestValue(
    AssertionSchema,
    headers.executionAssertion,
    401,
    'invalid_execution_identity',
  );
  parseRequestValue(
    SecretSchema,
    headers.modelApiKey,
    401,
    'invalid_model_credential',
  );
  const mcpCapability = headers.mcpCapability === undefined
    ? undefined
    : parseRequestValue(
      AssertionSchema,
      headers.mcpCapability,
      401,
      'invalid_mcp_capability',
    );
  const parsedRequest = parseRequestValue(
    ExecutionHostConversationTurnRequestSchema,
    await readJsonBody(request, signal),
    400,
    'invalid_request',
  );
  return {
    request: parsedRequest,
    runtimeSessionId,
    mcpCapability,
  };
}

export function writeLocalExecutionHostRejection(
  response: ServerResponse,
  error: unknown,
): void {
  const rejection = error instanceof LocalExecutionHostRequestError
    ? { status: error.status, code: error.code }
    : { status: 500, code: 'fixture_internal_error' };
  const safeCode = ErrorCodeSchema.parse(rejection.code);
  const body = JSON.stringify({
    error: {
      code: safeCode,
      message: 'Local Execution Host fixture rejected the request.',
    },
  });
  response.writeHead(rejection.status, {
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(body);
}

type InvocationHeaders = {
  localToken: string | undefined;
  runtimeSessionId: string | undefined;
  executionAssertion: string | undefined;
  mcpCapability: string | undefined;
  modelApiKey: string | undefined;
};

class LocalExecutionHostRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

function takeInvocationHeaders(request: IncomingMessage): InvocationHeaders {
  const extracted = {
    localToken: extractSensitiveHeader(
      request,
      EXECUTION_HOST_LOCAL_TOKEN_HEADER,
    ),
    runtimeSessionId: extractSensitiveHeader(
      request,
      AGENTCORE_RUNTIME_SESSION_HEADER,
    ),
    executionAssertion: extractSensitiveHeader(
      request,
      EXECUTION_ASSERTION_HEADER,
    ),
    mcpCapability: extractSensitiveHeader(request, MCP_CAPABILITY_HEADER),
    modelApiKey: extractSensitiveHeader(request, MODEL_API_KEY_HEADER),
  };
  if (Object.values(extracted).some((header) => header.duplicate)) {
    throw new LocalExecutionHostRequestError(
      400,
      'duplicate_sensitive_header',
    );
  }
  return Object.fromEntries(
    Object.entries(extracted).map(([name, header]) => [name, header.value]),
  ) as InvocationHeaders;
}

function extractSensitiveHeader(
  request: IncomingMessage,
  name: string,
): { value: string | undefined; duplicate: boolean } {
  const occurrences = request.rawHeaders.reduce(
    (count, headerName, index) => count
      + (index % 2 === 0 && headerName.toLowerCase() === name ? 1 : 0),
    0,
  );
  const value = request.headers[name];
  request.headers[name] = value === undefined
    ? undefined
    : REDACTED_HEADER_VALUE;
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index]?.toLowerCase() === name) {
      request.rawHeaders[index + 1] = REDACTED_HEADER_VALUE;
    }
  }
  return {
    value: Array.isArray(value) ? undefined : value,
    duplicate: occurrences > 1 || Array.isArray(value),
  };
}

function assertInvocationRoute(request: IncomingMessage): void {
  if (request.method !== 'POST') {
    throw new LocalExecutionHostRequestError(405, 'method_not_allowed');
  }
  if (request.url !== '/invocations') {
    throw new LocalExecutionHostRequestError(404, 'not_found');
  }
  const contentType = request.headers['content-type']
    ?.split(';', 1)[0]
    ?.trim()
    .toLowerCase();
  if (contentType !== 'application/json') {
    throw new LocalExecutionHostRequestError(
      415,
      'unsupported_media_type',
    );
  }
}

function assertLocalToken(actual: string | undefined, expected: string): void {
  if (!actual || !constantTimeEqual(actual, expected)) {
    throw new LocalExecutionHostRequestError(401, 'invalid_local_token');
  }
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftHash = createHash('sha256').update(left).digest();
  const rightHash = createHash('sha256').update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}

async function readJsonBody(
  request: IncomingMessage,
  signal: AbortSignal,
): Promise<unknown> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const rawChunk of request) {
    signal.throwIfAborted();
    const chunk = Buffer.isBuffer(rawChunk)
      ? rawChunk
      : Buffer.from(rawChunk as Uint8Array);
    totalBytes += chunk.byteLength;
    if (totalBytes > MAX_REQUEST_BODY_BYTES) {
      throw new LocalExecutionHostRequestError(413, 'request_too_large');
    }
    chunks.push(chunk);
  }
  if (totalBytes === 0) {
    throw new LocalExecutionHostRequestError(400, 'invalid_request');
  }
  try {
    return JSON.parse(Buffer.concat(chunks, totalBytes).toString('utf8'));
  } catch {
    throw new LocalExecutionHostRequestError(400, 'invalid_request');
  }
}

function parseRequestValue<T>(
  schema: z.ZodType<T>,
  value: unknown,
  status: number,
  code: string,
): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new LocalExecutionHostRequestError(status, code);
  }
  return parsed.data;
}
