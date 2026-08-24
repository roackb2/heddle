import { z } from 'zod';
import {
  OpaqueIdSchema,
  isSafeWebUrl,
} from '../contracts/index.js';
import {
  HOSTED_HEARTBEAT_COORDINATOR_PATHS,
  HostedHeartbeatCoordinatorTaskInputSchema,
  HostedHeartbeatCoordinatorTaskListSchema,
  type HostedHeartbeatCoordinatorTaskInput,
  type HostedHeartbeatCoordinatorTaskSummary,
} from './contracts.js';
import { HostedHeartbeatServiceTokenSchema } from './service-token.js';
import type {
  HostedHeartbeatCoordinatorClientConfig,
  HostedHeartbeatCoordinatorTaskApi,
} from './types.js';

const SafeBaseUrlSchema = z.custom<URL>(
  (value) => value instanceof URL && isSafeWebUrl(value),
  'baseUrl must be a safe HTTPS or loopback HTTP URL',
);

export class HostedHeartbeatCoordinatorRequestError extends Error {
  readonly name = 'HostedHeartbeatCoordinatorRequestError';

  constructor(
    readonly method: string,
    readonly path: string,
    readonly status: number,
  ) {
    super(`Heddle Coordinator ${method} ${path} failed with status ${status}.`);
  }
}

/** Authenticated desired-task and admission client for a Heddle Coordinator. */
export class HostedHeartbeatCoordinatorClient
implements HostedHeartbeatCoordinatorTaskApi {
  readonly #baseUrl: URL;
  readonly #authorization: string;
  readonly #fetch: typeof globalThis.fetch;

  constructor(config: HostedHeartbeatCoordinatorClientConfig) {
    this.#baseUrl = new URL(SafeBaseUrlSchema.parse(config.baseUrl));
    this.#authorization = `Bearer ${
      HostedHeartbeatServiceTokenSchema.parse(config.apiToken)
    }`;
    this.#fetch = config.fetch ?? globalThis.fetch;
  }

  async listTasks(
    signal?: AbortSignal,
  ): Promise<HostedHeartbeatCoordinatorTaskSummary[]> {
    const response = await this.#request(
      HOSTED_HEARTBEAT_COORDINATOR_PATHS.tasks,
      { method: 'GET', signal },
    );
    return HostedHeartbeatCoordinatorTaskListSchema.parse(
      await response.json(),
    ).tasks;
  }

  async upsertTask(
    rawTaskId: string,
    rawTask: HostedHeartbeatCoordinatorTaskInput,
    signal?: AbortSignal,
  ): Promise<void> {
    const taskId = OpaqueIdSchema.parse(rawTaskId);
    const task = HostedHeartbeatCoordinatorTaskInputSchema.parse(rawTask);
    await this.#request(this.#taskPath(taskId), {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(task),
      signal,
    });
  }

  async deleteTask(rawTaskId: string, signal?: AbortSignal): Promise<void> {
    await this.#request(this.#taskPath(OpaqueIdSchema.parse(rawTaskId)), {
      method: 'DELETE',
      signal,
    });
  }

  async pause(signal?: AbortSignal): Promise<void> {
    await this.#request(HOSTED_HEARTBEAT_COORDINATOR_PATHS.pause, {
      method: 'POST',
      signal,
    });
  }

  async resume(signal?: AbortSignal): Promise<void> {
    await this.#request(HOSTED_HEARTBEAT_COORDINATOR_PATHS.resume, {
      method: 'POST',
      signal,
    });
  }

  #taskPath(taskId: string): string {
    return `${HOSTED_HEARTBEAT_COORDINATOR_PATHS.tasks}/${
      encodeURIComponent(taskId)
    }`;
  }

  async #request(path: string, init: RequestInit): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set('authorization', this.#authorization);
    const response = await this.#fetch(new URL(path, this.#baseUrl), {
      ...init,
      headers,
      redirect: 'error',
    });
    if (!response.ok) {
      throw new HostedHeartbeatCoordinatorRequestError(
        init.method ?? 'GET',
        path,
        response.status,
      );
    }
    return response;
  }
}
