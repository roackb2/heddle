import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { z, ZodError } from 'zod';
import {
  HOSTED_HEARTBEAT_DELEGATIONS_PATH,
  HostedHeartbeatDelegationRequestSchema,
} from '../contracts.js';
import {
  HostedHeartbeatDelegationRejectedError,
} from '../hosted-heartbeat-delegation-service.js';
import { HostedHeartbeatServiceTokenSchema } from '../service-token.js';
import {
  NodeHttpPathSchema,
  NodeHttpRequestError,
  errorType,
  readJsonBody,
  readPathname,
  takeAuthorization,
  writeJson,
  writeJsonError,
} from '../../node/http-utils.js';
import type {
  NodeHostedHeartbeatDelegationFailure,
  NodeHostedHeartbeatDelegationHttpHandler,
  NodeHostedHeartbeatDelegationHttpServiceConfig,
} from './types.js';

const DEFAULT_MAX_BODY_BYTES = 16 * 1_024;

type ActiveDelegation = {
  abortController: AbortController;
  request: IncomingMessage;
  response: ServerResponse;
  pending: Promise<void>;
};

/** Standard authenticated Node HTTP edge for product-owned run authority. */
export class NodeHostedHeartbeatDelegationHttpService
implements NodeHostedHeartbeatDelegationHttpHandler {
  readonly #delegations: NodeHostedHeartbeatDelegationHttpServiceConfig[
    'delegations'
  ];
  readonly #tokenDigest: Buffer;
  readonly #path: string;
  readonly #maxBodyBytes: number;
  readonly #reportFailure: NodeHostedHeartbeatDelegationHttpServiceConfig[
    'reportFailure'
  ];
  readonly #active = new Set<ActiveDelegation>();
  #closed = false;
  #closePromise: Promise<void> | undefined;

  constructor(config: NodeHostedHeartbeatDelegationHttpServiceConfig) {
    this.#delegations = config.delegations;
    this.#tokenDigest = digest(
      HostedHeartbeatServiceTokenSchema.parse(config.apiToken),
    );
    this.#path = NodeHttpPathSchema.parse(
      config.path ?? HOSTED_HEARTBEAT_DELEGATIONS_PATH,
    );
    this.#maxBodyBytes = z.number().int().min(1).max(1_048_576).parse(
      config.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES,
    );
    this.#reportFailure = config.reportFailure;
  }

  handle(request: IncomingMessage, response: ServerResponse): boolean {
    if (readPathname(request.url) !== this.#path) {
      return false;
    }
    this.handleDelegation(request, response);
    return true;
  }

  handleDelegation(
    request: IncomingMessage,
    response: ServerResponse,
  ): void {
    if (this.#closed) {
      request.resume();
      writeJsonError(response, 503, 'Hosted execution is unavailable.');
      return;
    }

    let authorization: string | undefined;
    try {
      authorization = takeAuthorization(request);
      if (request.method !== 'POST') {
        request.resume();
        writeJsonError(response, 405, 'Method not allowed.', {
          Allow: 'POST',
        });
        return;
      }
    } catch (error) {
      request.resume();
      writeJsonError(
        response,
        error instanceof NodeHttpRequestError ? error.statusCode : 400,
        'Invalid heartbeat delegation request.',
      );
      return;
    }
    if (!this.#authenticates(authorization)) {
      request.resume();
      writeJsonError(response, 401, 'Authentication is required.', {
        'WWW-Authenticate': 'Bearer',
      });
      return;
    }

    const abortController = new AbortController();
    const abort = () => abortController.abort(
      new Error('The heartbeat delegation request closed.'),
    );
    request.once('aborted', abort);
    response.once('close', abort);
    const active: ActiveDelegation = {
      abortController,
      request,
      response,
      pending: Promise.resolve(),
    };
    active.pending = this.#serve(
      request,
      response,
      abortController.signal,
    ).finally(() => {
      request.removeListener('aborted', abort);
      response.removeListener('close', abort);
      this.#active.delete(active);
    });
    this.#active.add(active);
  }

  close(): Promise<void> {
    if (!this.#closePromise) {
      this.#closed = true;
      const active = [...this.#active];
      active.forEach(({ abortController, request, response }) => {
        abortController.abort(
          new Error('The heartbeat delegation service is stopping.'),
        );
        request.destroy();
        response.destroy();
      });
      this.#closePromise = Promise.allSettled(
        active.map(({ pending }) => pending),
      ).then(() => undefined);
    }
    return this.#closePromise;
  }

  async #serve(
    request: IncomingMessage,
    response: ServerResponse,
    signal: AbortSignal,
  ): Promise<void> {
    try {
      const input = HostedHeartbeatDelegationRequestSchema.parse(
        await readJsonBody(request, this.#maxBodyBytes, signal),
      );
      const delegation = await this.#delegations.issue(input, signal);
      writeJson(response, 200, delegation);
    } catch (error) {
      if (signal.aborted) {
        return;
      }
      if (error instanceof HostedHeartbeatDelegationRejectedError) {
        writeJsonError(response, 403, error.message);
        return;
      }
      if (error instanceof NodeHttpRequestError || error instanceof ZodError) {
        writeJsonError(
          response,
          error instanceof NodeHttpRequestError ? error.statusCode : 400,
          'Invalid heartbeat delegation request.',
        );
        return;
      }
      this.#report({ phase: 'delegation', errorType: errorType(error) });
      writeJsonError(response, 500, 'Heartbeat delegation failed.');
    }
  }

  #authenticates(authorization: string | undefined): boolean {
    const token = /^Bearer ([^\s]+)$/i.exec(
      authorization?.trim() ?? '',
    )?.[1];
    return token
      ? timingSafeEqual(digest(token), this.#tokenDigest)
      : false;
  }

  #report(failure: NodeHostedHeartbeatDelegationFailure): void {
    try {
      this.#reportFailure?.(Object.freeze({ ...failure }));
    } catch {
      // Observability must not change request settlement.
    }
  }
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}
