import {
  BedrockAgentCoreClient,
  InvokeAgentRuntimeCommand,
  type InvokeAgentRuntimeCommandOutput,
} from '@aws-sdk/client-bedrock-agentcore';
import { HttpRequest } from '@smithy/protocol-http';
import {
  AGENTCORE_RUNTIME_SESSION_HEADER,
  EXECUTION_ASSERTION_HEADER,
  EXECUTION_HOST_LOCAL_TOKEN_HEADER,
  MCP_CAPABILITY_HEADER,
  MODEL_API_KEY_HEADER,
  type ExecutionHostStreamEvent,
} from '../contracts/index.js';
import {
  DirectHttpExecutionHost,
  type ExecutionHost,
  type ExecutionHostConversationTurn,
} from '../http-sse/index.js';
import type {
  AgentCoreExecutionHostConfig,
  AgentCoreRuntimeClient,
} from './types.js';

const CONTENT_TYPE = 'application/json';
const ACCEPT = 'text/event-stream';
const MIN_RUNTIME_SESSION_ID_LENGTH = 33;
const MAX_RUNTIME_SESSION_ID_LENGTH = 256;
const RUNTIME_SESSION_ID_PATTERN = /^[A-Za-z0-9](?:-*[A-Za-z0-9])+$/;
const WIRE_BRIDGE_URL = new URL('http://127.0.0.1/agentcore-bridge');
const NON_FORWARDED_LOCAL_TOKEN = 'agentcore-bridge-token-never-forwarded';
const SERVICE_ERROR_CODES = new Map<string, string>([
  ['AccessDeniedException', 'access_denied'],
  ['InternalServerException', 'runtime_internal'],
  ['ResourceNotFoundException', 'runtime_not_found'],
  ['RetryableConflictException', 'runtime_conflict'],
  ['RuntimeClientError', 'runtime_client_error'],
  ['ServiceQuotaExceededException', 'quota_exceeded'],
  ['ThrottlingException', 'throttled'],
  ['ValidationException', 'invalid_request'],
]);

/**
 * Invokes one compatible Heddle Execution Host through AWS AgentCore while
 * reusing the package's strict request and SSE protocol validation.
 */
export class AgentCoreExecutionHost implements ExecutionHost {
  readonly #client: AgentCoreRuntimeClient;
  readonly #runtimeArn: string;
  readonly #qualifier?: string;
  readonly #wire: DirectHttpExecutionHost;

  constructor(config: AgentCoreExecutionHostConfig) {
    this.#runtimeArn = config.runtimeArn;
    this.#qualifier = config.qualifier;
    this.#client = config.client ?? new BedrockAgentCoreClient({
      region: config.region,
      // Invocation settlement is ambiguous after a transport interruption.
      // Product policy, not the AWS client, decides whether a turn may retry.
      maxAttempts: 1,
    });
    this.#wire = new DirectHttpExecutionHost({
      baseUrl: WIRE_BRIDGE_URL,
      localToken: NON_FORWARDED_LOCAL_TOKEN,
      fetch: (_input, init) => this.#invoke(init),
    });
  }

  streamConversationTurn(
    input: ExecutionHostConversationTurn,
  ): AsyncIterable<ExecutionHostStreamEvent> {
    assertAgentCoreRuntimeSessionId(input.runtimeSessionId);
    return this.#wire.streamConversationTurn(input);
  }

  close(): void {
    this.#client.destroy?.();
  }

  async #invoke(init?: RequestInit): Promise<Response> {
    if (init?.method !== 'POST' || typeof init.body !== 'string') {
      throw new Error('AgentCore wire bridge received an invalid request.');
    }
    const headers = new Headers(init.headers);
    const runtimeSessionId = requireHeader(
      headers,
      AGENTCORE_RUNTIME_SESSION_HEADER,
    );
    const customHeaders = Object.fromEntries([
      [
        EXECUTION_ASSERTION_HEADER,
        requireHeader(headers, EXECUTION_ASSERTION_HEADER),
      ],
      [MODEL_API_KEY_HEADER, requireHeader(headers, MODEL_API_KEY_HEADER)],
      ...(headers.has(MCP_CAPABILITY_HEADER)
        ? [[MCP_CAPABILITY_HEADER, headers.get(MCP_CAPABILITY_HEADER)!]]
        : []),
    ]);
    const command = new InvokeAgentRuntimeCommand({
      agentRuntimeArn: this.#runtimeArn,
      runtimeSessionId,
      qualifier: this.#qualifier,
      contentType: CONTENT_TYPE,
      accept: ACCEPT,
      payload: new TextEncoder().encode(init.body),
    });
    addSignedCustomHeaders(command, customHeaders);
    const signal = init.signal ?? undefined;

    try {
      const output = await this.#client.send(command, { abortSignal: signal });
      return new Response(
        output.response ? toReadableStream(output.response) : null,
        {
          status: output.statusCode ?? output.$metadata.httpStatusCode ?? 200,
          headers: {
            'content-type': output.contentType ?? 'application/octet-stream',
          },
        },
      );
    } catch (error) {
      if (signal?.aborted) {
        throw error;
      }
      const status = readServiceStatus(error);
      if (!status) {
        throw error;
      }
      const code = SERVICE_ERROR_CODES.get(readErrorName(error)) ?? 'unknown';
      return new Response(JSON.stringify({
        error: {
          code,
          message: 'AgentCore rejected the invocation.',
        },
      }), {
        status,
        headers: { 'content-type': CONTENT_TYPE },
      });
    }
  }
}

function assertAgentCoreRuntimeSessionId(value: string): void {
  if (
    value.length < MIN_RUNTIME_SESSION_ID_LENGTH
    || value.length > MAX_RUNTIME_SESSION_ID_LENGTH
    || !RUNTIME_SESSION_ID_PATTERN.test(value)
  ) {
    throw new Error('AgentCore runtime session ID is not provider-compatible.');
  }
}

function addSignedCustomHeaders(
  command: InvokeAgentRuntimeCommand,
  headers: Readonly<Record<string, string>>,
): void {
  command.middlewareStack.add(
    (next) => async (args) => {
      if (!HttpRequest.isInstance(args.request)) {
        throw new Error('AgentCore invocation did not produce an HTTP request.');
      }
      Object.assign(args.request.headers, headers);
      return await next(args);
    },
    {
      step: 'build',
      priority: 'low',
      name: 'heddleAgentCoreCustomHeaders',
    },
  );
}

function requireHeader(headers: Headers, name: string): string {
  const value = headers.get(name);
  if (!value) {
    throw new Error('AgentCore wire bridge omitted required authority.');
  }
  return value;
}

function toReadableStream(
  source: NonNullable<InvokeAgentRuntimeCommandOutput['response']>,
): ReadableStream<Uint8Array> {
  if (source instanceof Blob) {
    return source.stream();
  }
  if (source instanceof ReadableStream) {
    return source;
  }
  if (!isAsyncIterable(source)) {
    throw new Error('AgentCore returned an unsupported stream type.');
  }
  const iterator = source[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const item = await iterator.next();
        if (item.done) {
          controller.close();
          return;
        }
        if (!(item.value instanceof Uint8Array)) {
          throw new Error('AgentCore returned a non-binary stream chunk.');
        }
        controller.enqueue(item.value);
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel() {
      await iterator.return?.();
    },
  });
}

function isAsyncIterable(
  value: unknown,
): value is AsyncIterable<Uint8Array> {
  return Boolean(
    value
    && typeof value === 'object'
    && Symbol.asyncIterator in value
    && typeof value[Symbol.asyncIterator] === 'function',
  );
}

function readServiceStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object' || !('$metadata' in error)) {
    return undefined;
  }
  const metadata = (error as { $metadata?: { httpStatusCode?: unknown } })
    .$metadata;
  const status = metadata?.httpStatusCode;
  return typeof status === 'number' && status >= 400 && status <= 599
    ? status
    : undefined;
}

function readErrorName(error: unknown): string {
  return error instanceof Error ? error.name : '';
}

export const AGENTCORE_FORWARDED_HEADER_NAMES = Object.freeze([
  EXECUTION_ASSERTION_HEADER,
  MCP_CAPABILITY_HEADER,
  MODEL_API_KEY_HEADER,
] as const);

export const AGENTCORE_EXCLUDED_HEADER_NAMES = Object.freeze([
  EXECUTION_HOST_LOCAL_TOKEN_HEADER,
] as const);
