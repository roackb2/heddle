import {
  randomBytes,
  randomUUID,
} from 'node:crypto';
import { once } from 'node:events';
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { DirectHttpExecutionHost } from '../http-sse/index.js';
import {
  LocalExecutionHostEventStream,
  parseLocalExecutionHostTerminal,
} from './event-stream.js';
import { CredentialBoundLocalInvocation } from './invocation.js';
import {
  parseLocalExecutionHostRequest,
  writeLocalExecutionHostRejection,
  type ParsedLocalExecutionHostRequest,
} from './request.js';
import type {
  LocalExecutionHostContractFixtureOptions,
  LocalExecutionHostTerminal,
} from './types.js';

/**
 * Real loopback implementation of the Execution Host v1 HTTP/SSE boundary.
 *
 * It is intentionally a contract fixture, not a fake Heddle runtime. The
 * supplied executor can call product APIs or MCP tools, while this class owns
 * request validation, credential containment, SSE ordering, and lifecycle.
 */
export class LocalExecutionHostContractFixture {
  readonly #execute: LocalExecutionHostContractFixtureOptions['execute'];
  readonly #now: () => Date;
  readonly #createRunId: () => string;
  readonly #localToken: string;
  readonly #server: Server;
  readonly #activeInvocations = new Set<ActiveInvocation>();
  #baseUrl: URL | undefined;
  #closePromise: Promise<void> | undefined;
  #closing = false;

  private constructor(options: LocalExecutionHostContractFixtureOptions) {
    if (typeof options.execute !== 'function') {
      throw new TypeError('Local Execution Host fixture requires an executor.');
    }
    this.#execute = options.execute;
    this.#now = options.now ?? (() => new Date());
    this.#createRunId = options.createRunId ?? randomUUID;
    this.#localToken = randomBytes(32).toString('base64url');
    this.#server = createServer((request, response) => {
      this.#dispatch(request, response);
    });
  }

  static async start(
    options: LocalExecutionHostContractFixtureOptions,
  ): Promise<LocalExecutionHostContractFixture> {
    const fixture = new LocalExecutionHostContractFixture(options);
    await fixture.#listen();
    return fixture;
  }

  /** Return a fresh client paired with this fixture's hidden local token. */
  createExecutionHost(): DirectHttpExecutionHost {
    return new DirectHttpExecutionHost({
      baseUrl: this.baseUrl(),
      localToken: this.#localToken,
    });
  }

  /** A copy of the loopback URL, useful for explicit negative protocol tests. */
  baseUrl(): URL {
    if (!this.#baseUrl) {
      throw new Error('Local Execution Host fixture has not started.');
    }
    return new URL(this.#baseUrl);
  }

  /** Abort active invocations, close sockets, and wait for handler cleanup. */
  close(): Promise<void> {
    this.#closePromise ??= this.#close();
    return this.#closePromise;
  }

  async #listen(): Promise<void> {
    this.#server.listen(0, '127.0.0.1');
    await once(this.#server, 'listening');
    const address = this.#server.address();
    if (!address || typeof address === 'string') {
      await this.close();
      throw new Error('Local Execution Host fixture did not bind a TCP port.');
    }
    this.#baseUrl = new URL(`http://127.0.0.1:${address.port}/`);
  }

  #dispatch(request: IncomingMessage, response: ServerResponse): void {
    const controller = new AbortController();
    if (this.#closing) {
      controller.abort();
      request.destroy();
      response.destroy();
      return;
    }
    const active: ActiveInvocation = {
      controller,
      completed: Promise.resolve(),
    };
    const completed = this.#handle(request, response, controller)
      .catch(() => {
        response.destroy();
      })
      .finally(() => {
        this.#activeInvocations.delete(active);
      });
    active.completed = completed;
    this.#activeInvocations.add(active);
  }

  async #handle(
    request: IncomingMessage,
    response: ServerResponse,
    controller: AbortController,
  ): Promise<void> {
    const abort = () => controller.abort();
    const abortIncompleteResponse = () => {
      if (!response.writableEnded) {
        abort();
      }
    };
    request.once('aborted', abort);
    response.once('close', abortIncompleteResponse);

    try {
      const parsed = await parseLocalExecutionHostRequest(
        request,
        this.#localToken,
        controller.signal,
      );
      controller.signal.throwIfAborted();
      await this.#streamInvocation(parsed, response, controller);
    } catch (error) {
      if (controller.signal.aborted) {
        response.destroy();
        return;
      }
      if (!response.headersSent) {
        writeLocalExecutionHostRejection(response, error);
        return;
      }
      response.destroy();
    } finally {
      request.off('aborted', abort);
      response.off('close', abortIncompleteResponse);
    }
  }

  async #streamInvocation(
    input: ParsedLocalExecutionHostRequest,
    response: ServerResponse,
    controller: AbortController,
  ): Promise<void> {
    const stream = await LocalExecutionHostEventStream.open({
      response,
      signal: controller.signal,
      invocationId: input.request.invocationId,
      runId: this.#createRunId(),
      now: this.#now,
    });
    let acceptingActivities = true;
    let activityWrites = Promise.resolve();
    let activityFailure: unknown;
    const publishActivity = (activity: unknown): Promise<void> => {
      if (!acceptingActivities) {
        return Promise.reject(new Error(
          'Cannot publish activity after local invocation settlement.',
        ));
      }
      const write = activityWrites.then(
        () => stream.publishActivity(activity),
      );
      activityWrites = write.catch((error: unknown) => {
        activityFailure ??= error;
      });
      return write;
    };
    const invocation = new CredentialBoundLocalInvocation({
      ...input,
      signal: controller.signal,
      publishActivity,
    });

    let terminal: LocalExecutionHostTerminal;
    try {
      terminal = parseLocalExecutionHostTerminal(
        await this.#execute(invocation),
      );
    } catch {
      controller.signal.throwIfAborted();
      terminal = {
        kind: 'error',
        error: {
          code: 'fixture_execution_failed',
          message: 'Local fixture execution failed.',
        },
      };
    } finally {
      acceptingActivities = false;
    }

    await activityWrites;
    if (activityFailure) {
      throw activityFailure;
    }
    await stream.settle(terminal);
  }

  async #close(): Promise<void> {
    this.#closing = true;
    for (const invocation of this.#activeInvocations) {
      invocation.controller.abort();
    }
    const serverClosed = new Promise<void>((resolve, reject) => {
      this.#server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
    this.#server.closeAllConnections();
    await serverClosed;
    while (this.#activeInvocations.size > 0) {
      const active = [...this.#activeInvocations];
      for (const invocation of active) {
        invocation.controller.abort();
      }
      await Promise.allSettled(
        active.map((invocation) => invocation.completed),
      );
    }
  }
}

type ActiveInvocation = {
  controller: AbortController;
  completed: Promise<void>;
};
