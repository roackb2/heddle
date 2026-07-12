/**
 * Stage 05.2 Express/SSE adapter for the transport-neutral hosted service.
 *
 * The host owns authentication, authorization, public schemas, HTTP policy,
 * and deployment. Reimplement this adapter in the host's existing framework
 * when Express/SSE is not already part of the stack.
 */
import { once } from 'node:events';
import {
  Router,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';
import { z, ZodError } from 'zod';
import { ConversationRunConflictError } from '../../../../src/hosted.js';
import {
  HostedAgentInputError,
  HostedAgentRunNotFoundError,
  type HostedAgentService,
} from '../01-hosted-service/agent-service.js';
import {
  CancelHostedAgentRunResultSchema,
  HostedAgentApiErrorSchema,
  HostedAgentRunProtocol,
  HostedAgentRunEventSchema,
  StartHostedAgentRunInputSchema,
  StartHostedAgentRunResultSchema,
  type HostedAgentRunEvent,
} from './contracts.js';

const AuthenticatedAccountSchema = z.object({
  accountId: z.string().trim().min(1),
});
const RunIdSchema = z.string().trim().min(1);
const ReplayCursorSchema = z.string()
  .regex(/^(0|[1-9]\d*)$/, 'Replay cursor must be a non-negative integer.')
  .transform(Number)
  .refine(Number.isSafeInteger, 'Replay cursor must be a safe integer.');

export type HostedAgentApiDeps = {
  agent: HostedAgentService;
  authenticate(request: Request): Promise<{ accountId: string }>;
  onError?(error: unknown): void;
};

export class HostedAgentApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function createHostedAgentApiRouter(deps: HostedAgentApiDeps): Router {
  const router = Router();
  router.post('/runs', createStartHostedAgentRunHandler(deps));
  router.get('/runs/:runId/events', createSubscribeHostedAgentRunHandler(deps));
  router.post('/runs/:runId/cancel', createCancelHostedAgentRunHandler(deps));
  return router;
}

export function createStartHostedAgentRunHandler(deps: HostedAgentApiDeps): RequestHandler {
  return async (request, response) => {
    try {
      const { accountId } = await authenticate(deps, request);
      const input = StartHostedAgentRunInputSchema.parse(request.body);
      const accepted = await deps.agent.start({ accountId, ...input });
      response.status(202).json(StartHostedAgentRunResultSchema.parse(accepted));
    } catch (error) {
      sendRequestError(deps, response, error);
    }
  };
}

export function createSubscribeHostedAgentRunHandler(deps: HostedAgentApiDeps): RequestHandler {
  return async (request, response) => {
    const subscription = new AbortController();
    const abortSubscription = () => subscription.abort();
    request.once('aborted', abortSubscription);
    response.once('close', abortSubscription);

    try {
      const { accountId } = await authenticate(deps, request);
      const runId = RunIdSchema.parse(request.params.runId);
      const afterSequence = parseReplayCursor(request);
      const events = deps.agent.subscribe({
        accountId,
        runId,
        afterSequence,
        signal: subscription.signal,
      });

      setSseHeaders(response);
      for await (const event of events) {
        await writeSseEvent(response, HostedAgentRunEventSchema.parse(event), subscription.signal);
      }
      endResponse(response);
    } catch (error) {
      if (subscription.signal.aborted) {
        return;
      }
      if (!response.headersSent) {
        sendRequestError(deps, response, error);
        return;
      }
      deps.onError?.(error);
      endResponse(response);
    } finally {
      request.off('aborted', abortSubscription);
      response.off('close', abortSubscription);
    }
  };
}

export function createCancelHostedAgentRunHandler(deps: HostedAgentApiDeps): RequestHandler {
  return async (request, response) => {
    try {
      const { accountId } = await authenticate(deps, request);
      const runId = RunIdSchema.parse(request.params.runId);
      response.json(CancelHostedAgentRunResultSchema.parse({
        cancelled: deps.agent.cancel(accountId, runId),
      }));
    } catch (error) {
      sendRequestError(deps, response, error);
    }
  };
}

async function authenticate(deps: HostedAgentApiDeps, request: Request): Promise<{ accountId: string }> {
  return AuthenticatedAccountSchema.parse(await deps.authenticate(request));
}

function parseReplayCursor(request: Request): number | undefined {
  // An explicit query cursor wins over Last-Event-ID so fetch clients can
  // deliberately choose their checkpoint; native EventSource uses the header.
  const value = request.query.after ?? request.header('Last-Event-ID');
  return value === undefined ? undefined : ReplayCursorSchema.parse(value);
}

function setSseHeaders(response: Response): void {
  response.status(200);
  response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  response.setHeader('Cache-Control', 'no-cache, no-transform');
  response.setHeader('Connection', 'keep-alive');
  response.setHeader('X-Accel-Buffering', 'no');
  response.flushHeaders?.();
}

async function writeSseEvent(
  response: Response,
  event: HostedAgentRunEvent,
  signal: AbortSignal,
): Promise<void> {
  const frame = `event: ${event.kind}\nid: ${event.sequence}\ndata: ${HostedAgentRunProtocol.stringifyEvent(event)}\n\n`;
  if (response.write(frame)) {
    return;
  }
  await once(response, 'drain', { signal });
}

function endResponse(response: Response): void {
  if (!response.destroyed && !response.writableEnded) {
    response.end();
  }
}

function sendRequestError(deps: HostedAgentApiDeps, response: Response, error: unknown): void {
  const apiError = toApiError(error);
  if (apiError.status >= 500) {
    deps.onError?.(error);
  }
  response.status(apiError.status).json(HostedAgentApiErrorSchema.parse({
    error: {
      code: apiError.code,
      message: apiError.message,
    },
  }));
}

function toApiError(error: unknown): HostedAgentApiError {
  if (error instanceof HostedAgentApiError) {
    return error;
  }
  if (error instanceof HostedAgentRunNotFoundError) {
    return new HostedAgentApiError(404, 'run_not_found', error.message);
  }
  if (error instanceof ConversationRunConflictError) {
    return new HostedAgentApiError(409, 'run_conflict', error.message);
  }
  if (error instanceof HostedAgentInputError || error instanceof ZodError) {
    return new HostedAgentApiError(400, 'invalid_request', 'Request validation failed.');
  }
  return new HostedAgentApiError(500, 'internal_error', 'The hosted agent request failed.');
}
