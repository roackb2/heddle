import { z } from 'zod';
import {
  AGENTCORE_RUNTIME_SESSION_HEADER,
  CONVERSATION_TURN_WORKFLOW,
  EXECUTION_ASSERTION_HEADER,
  EXECUTION_CONTRACT_VERSION,
  EXECUTION_HOST_LOCAL_TOKEN_HEADER,
  ExecutionHostConversationTurnRequestSchema,
  ExecutionHostHeartbeatStreamEventSchema,
  ExecutionHostHeartbeatTaskRequestSchema,
  ExecutionHostStreamEventSchema,
  HEARTBEAT_TASK_WORKFLOW,
  MCP_CAPABILITY_HEADER,
  MODEL_API_KEY_HEADER,
  OpaqueIdSchema,
  RuntimeSessionIdSchema,
  TimestampSchema,
  isExecutionHostHeartbeatTerminalEvent,
  isExecutionHostTerminalEvent,
  isSafeWebUrl,
  type ExecutionHostHeartbeatStreamEvent,
  type ExecutionHostStreamEvent,
} from '../contracts/index.js';
import {
  ExecutionHostInvocationCancelledError,
  ExecutionHostRejectedError,
} from './errors.js';
import type {
  DirectHttpExecutionHostConfig,
  ExecutionHost,
  ExecutionHostConversationTurn,
  ExecutionHostHeartbeatTask,
  HeartbeatExecutionHost,
} from './types.js';
import {
  readExecutionHostEventStream,
  toExecutionHostTransportError,
} from '../internal/execution-host-event-stream.js';
import { readBoundedJsonResponse } from '../internal/http-response.js';

const MAX_ERROR_BODY_BYTES = 16_384;
const SecretSchema = z.string().min(8).max(4_096);
const InvocationAuthoritySchema = z.object({
  runtimeSessionId: RuntimeSessionIdSchema,
  executionAssertion: z.string().min(32).max(4_096),
  mcpCapability: z.string().min(32).max(4_096).optional(),
  modelApiKey: SecretSchema,
  signal: z.custom<AbortSignal>(
    (value) => value instanceof AbortSignal,
    'signal must be an AbortSignal',
  ).optional(),
}).strict();
const ConversationTurnSchema = InvocationAuthoritySchema.extend({
  invocationId: OpaqueIdSchema,
  prompt: z.string().trim().min(1).max(200_000),
  deadlineAt: TimestampSchema.optional(),
}).strict();
const HeartbeatTaskSchema = InvocationAuthoritySchema.extend(
  ExecutionHostHeartbeatTaskRequestSchema.omit({
    schemaVersion: true,
    kind: true,
  }).shape,
).strict();
const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string().min(1).max(128).regex(/^[a-z0-9_]+$/),
    message: z.string(),
  }).strict(),
}).strict();

/**
 * Strict direct-development HTTP/SSE adapter for the Execution Host v1 wire.
 * It deliberately owns neither AWS SDK nor SigV4 behavior.
 */
export class DirectHttpExecutionHost
implements ExecutionHost, HeartbeatExecutionHost {
  readonly #endpoint: URL;
  readonly #fetch: typeof fetch;
  readonly #localToken: string;

  constructor(config: DirectHttpExecutionHostConfig) {
    assertSafeBaseUrl(config.baseUrl);
    this.#localToken = SecretSchema.parse(config.localToken);
    this.#endpoint = new URL('invocations', withTrailingSlash(config.baseUrl));
    this.#fetch = config.fetch ?? globalThis.fetch;
  }

  async *streamConversationTurn(
    rawInput: ExecutionHostConversationTurn,
  ): AsyncIterable<ExecutionHostStreamEvent> {
    const input = ConversationTurnSchema.parse(rawInput);
    if (input.signal?.aborted) {
      throw new ExecutionHostInvocationCancelledError();
    }
    const body = ExecutionHostConversationTurnRequestSchema.parse({
      schemaVersion: EXECUTION_CONTRACT_VERSION,
      kind: CONVERSATION_TURN_WORKFLOW,
      invocationId: input.invocationId,
      prompt: input.prompt,
      ...(input.deadlineAt ? { deadlineAt: input.deadlineAt } : {}),
    });
    yield* this.#streamInvocation(
      input,
      body,
      ExecutionHostStreamEventSchema,
      isExecutionHostTerminalEvent,
    );
  }

  async *streamHeartbeatTask(
    rawInput: ExecutionHostHeartbeatTask,
  ): AsyncIterable<ExecutionHostHeartbeatStreamEvent> {
    const input = HeartbeatTaskSchema.parse(rawInput);
    if (input.signal?.aborted) {
      throw new ExecutionHostInvocationCancelledError();
    }
    const body = ExecutionHostHeartbeatTaskRequestSchema.parse({
      schemaVersion: EXECUTION_CONTRACT_VERSION,
      kind: HEARTBEAT_TASK_WORKFLOW,
      invocationId: input.invocationId,
      taskId: input.taskId,
      task: input.task,
      ...(input.checkpoint ? { checkpoint: input.checkpoint } : {}),
      runContext: input.runContext,
      ...(input.model ? { model: input.model } : {}),
      ...(input.reasoningEffort
        ? { reasoningEffort: input.reasoningEffort }
        : {}),
      ...(input.maxSteps !== undefined ? { maxSteps: input.maxSteps } : {}),
      ...(input.searchIgnoreDirs
        ? { searchIgnoreDirs: input.searchIgnoreDirs }
        : {}),
      ...(input.systemContext ? { systemContext: input.systemContext } : {}),
      ...(input.deadlineAt ? { deadlineAt: input.deadlineAt } : {}),
    });
    yield* this.#streamInvocation(
      input,
      body,
      ExecutionHostHeartbeatStreamEventSchema,
      isExecutionHostHeartbeatTerminalEvent,
    );
  }

  async *#streamInvocation<TEvent extends ValidatedStreamEvent>(
    input: InvocationInput,
    body: unknown,
    schema: z.ZodType<TEvent>,
    isTerminal: (event: TEvent) => boolean,
  ): AsyncIterable<TEvent> {
    const response = await this.#invoke(input, body);
    if (!response.ok) {
      throw new ExecutionHostRejectedError(
        response.status,
        await readSafeErrorCode(response),
      );
    }
    yield* readExecutionHostEventStream({
      response,
      schema,
      isTerminal,
      invocationId: input.invocationId,
      signal: input.signal,
    });
  }

  async #invoke(input: InvocationInput, body: unknown): Promise<Response> {
    try {
      return await this.#fetch(this.#endpoint, {
        method: 'POST',
        redirect: 'error',
        signal: input.signal,
        headers: createSensitiveHeaders(input, this.#localToken),
        body: JSON.stringify(body),
      });
    } catch (error) {
      throw toExecutionHostTransportError(error, input.signal);
    }
  }
}

type InvocationInput = {
  invocationId: string;
  runtimeSessionId: string;
  executionAssertion: string;
  mcpCapability?: string;
  modelApiKey: string;
  signal?: AbortSignal;
};

type ValidatedStreamEvent = {
  kind: string;
  invocationId: string;
  runId: string;
  sequence: number;
  timestamp: string;
};

function createSensitiveHeaders(
  input: InvocationInput,
  localToken: string,
): Headers {
  const headers = new Headers({
    Accept: 'text/event-stream',
    'Content-Type': 'application/json',
    [AGENTCORE_RUNTIME_SESSION_HEADER]: input.runtimeSessionId,
    [EXECUTION_HOST_LOCAL_TOKEN_HEADER]: localToken,
    [MODEL_API_KEY_HEADER]: input.modelApiKey,
    [EXECUTION_ASSERTION_HEADER]: input.executionAssertion,
  });
  if (input.mcpCapability) {
    headers.set(MCP_CAPABILITY_HEADER, input.mcpCapability);
  }
  return headers;
}

async function readSafeErrorCode(response: Response): Promise<string> {
  try {
    const parsed = ApiErrorSchema.safeParse(await readBoundedJsonResponse(
      response,
      MAX_ERROR_BODY_BYTES,
    ));
    return parsed.success ? parsed.data.error.code : 'unknown';
  } catch {
    return 'unknown';
  }
}

function assertSafeBaseUrl(url: URL): void {
  if (!isSafeWebUrl(url)) {
    throw new Error(
      'Direct Execution Host URL must use HTTPS or loopback HTTP and contain no credentials, query, or fragment.',
    );
  }
}

function withTrailingSlash(url: URL): URL {
  const normalized = new URL(url);
  normalized.pathname = normalized.pathname.endsWith('/')
    ? normalized.pathname
    : `${normalized.pathname}/`;
  return normalized;
}
