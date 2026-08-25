import type {
  ExecutionAuthorityIssuer,
} from '../authority/index.js';
import type {
  HostedModelCredentialProvider,
} from '../conversation/index.js';
import type {
  HostedHeartbeatAgentExecutionTransportInput,
} from '../heartbeat/index.js';
import type { HeartbeatExecutionHost } from '../http-sse/index.js';
import type {
  HostedHeartbeatCoordinatorTaskInput,
  HostedHeartbeatCoordinatorState,
  HostedHeartbeatCoordinatorTaskDetail,
  HostedHeartbeatCoordinatorTaskView,
  HostedHeartbeatDelegation,
  HostedHeartbeatDelegationAuthorization,
  HostedHeartbeatDelegationRequest,
  HostedHeartbeatDesiredTask,
} from './contracts.js';

export type HostedHeartbeatCoordinatorClientConfig = {
  baseUrl: URL;
  apiToken: string;
  fetch?: typeof globalThis.fetch;
};

export interface HostedHeartbeatCoordinatorTaskApi {
  readState(signal?: AbortSignal): Promise<HostedHeartbeatCoordinatorState>;
  listTasks(
    signal?: AbortSignal,
  ): Promise<HostedHeartbeatCoordinatorTaskView[]>;
  readTask(
    taskId: string,
    signal?: AbortSignal,
  ): Promise<HostedHeartbeatCoordinatorTaskDetail>;
  upsertTask(
    taskId: string,
    task: HostedHeartbeatCoordinatorTaskInput,
    signal?: AbortSignal,
  ): Promise<void>;
  triggerTask(
    taskId: string,
    signal?: AbortSignal,
  ): Promise<HostedHeartbeatCoordinatorTaskView>;
  deleteTask(taskId: string, signal?: AbortSignal): Promise<void>;
  pause(signal?: AbortSignal): Promise<void>;
  resume(signal?: AbortSignal): Promise<void>;
  drain(signal?: AbortSignal): Promise<void>;
}

export type HostedHeartbeatTaskReconciliationInput = {
  desiredTasks: readonly HostedHeartbeatDesiredTask[];
  resume: boolean;
  signal?: AbortSignal;
};

export type HostedHeartbeatTaskReconciliation = {
  deleted: number;
  upserted: number;
  resumed: boolean;
};

export type HostedHeartbeatTaskReconcilerConfig = {
  coordinator: Pick<
    HostedHeartbeatCoordinatorTaskApi,
    'listTasks' | 'upsertTask' | 'deleteTask' | 'pause' | 'resume'
  >;
};

export type HostedHeartbeatDelegationAuthorizationInput = {
  taskId: string;
  executionId: string;
  signal: AbortSignal;
};

export interface HostedHeartbeatDelegationAuthorizer {
  authorize(
    input: HostedHeartbeatDelegationAuthorizationInput,
  ): HostedHeartbeatDelegationAuthorization
    | undefined
    | Promise<HostedHeartbeatDelegationAuthorization | undefined>;
}

export type HostedHeartbeatDelegationServiceConfig = {
  authority: ExecutionAuthorityIssuer;
  authorizer: HostedHeartbeatDelegationAuthorizer;
  runtimeSessionNamespace: string;
  maxExecutionMs: number;
  now?: () => Date;
};

export interface HostedHeartbeatDelegationIssuer {
  issue(
    input: HostedHeartbeatDelegationRequest,
    signal?: AbortSignal,
  ): Promise<HostedHeartbeatDelegation>;
}

export type HostedHeartbeatDelegationClientConfig = {
  baseUrl: URL;
  apiToken: string;
  fetch?: typeof globalThis.fetch;
  path?: string;
};

export type HostedHeartbeatDelegatedExecutionTransportConfig = {
  delegations: HostedHeartbeatDelegationIssuer;
  executionHost: HeartbeatExecutionHost;
  modelCredentials: HostedModelCredentialProvider;
};

export interface HostedHeartbeatDelegatedExecutionTransportPort {
  execute(
    input: HostedHeartbeatAgentExecutionTransportInput,
  ): Promise<unknown>;
}
