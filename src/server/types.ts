import type { Request } from 'express';
import type { Logger } from 'pino';
import type { ControlPlaneServerRecord } from '@/core/runtime/daemon/index.js';
import type { WorkspaceDescriptor } from '@/core/runtime/workspaces/index.js';

export type HeddleServerPrincipal = {
  id: string;
  displayName?: string;
  auditMetadata?: Readonly<Record<string, string | number | boolean | null>>;
};

export type HeddleServerWorkspaceScope = {
  workspaceId: string;
  /**
   * Omit to permit every session in the workspace. An empty array permits
   * workspace-level operations but no session-level operation.
   */
  sessionIds?: readonly string[];
};

export type HeddleServerHostedRequestAccess = {
  principal: HeddleServerPrincipal;
  scope: {
    workspaces: readonly HeddleServerWorkspaceScope[];
  };
};

export type HeddleServerRequestAccess =
  | (HeddleServerHostedRequestAccess & { mode: 'hosted' })
  | {
    mode: 'local';
    principal: HeddleServerPrincipal;
    scope: {
      workspaces: 'all';
    };
  };

export type HeddleControlPlaneOperation = {
  name: string;
  type: 'query' | 'mutation' | 'subscription';
  workspaceId?: string;
  sessionId?: string;
};

export type HeddleControlPlaneOperationAuthorization = {
  access: HeddleServerRequestAccess;
  operation: HeddleControlPlaneOperation;
};

export type HeddleControlPlaneAuditEvent = {
  operation: 'approval.resolve' | 'run.cancel';
  occurredAt: string;
  actor: HeddleServerPrincipal;
  workspaceId: string;
  sessionId: string;
  runId?: string;
  metadata?: Readonly<Record<string, string | number | boolean | null>>;
};

export type HeddleServerAccessControl =
  | {
    /**
     * Unauthenticated single-operator mode for a local daemon. This mode is
     * intentionally not safe for hosted or multi-tenant deployment.
     */
    mode: 'local';
  }
  | {
    mode: 'hosted';
    /**
     * Authenticate the HTTP request and return only the workspace/session
     * scope that the principal may address. Return null when unauthenticated.
     */
    resolveRequestAccess: (
      request: Request,
    ) => HeddleServerHostedRequestAccess | null | Promise<HeddleServerHostedRequestAccess | null>;
    /**
     * Optional product authorization hook. Heddle enforces the resolved static
     * workspace/session scope before invoking this hook.
     */
    authorizeOperation?: (
      authorization: HeddleControlPlaneOperationAuthorization,
    ) => void | Promise<void>;
    /**
     * Optional host audit sink. Heddle also records the same event in the
     * workspace operation log before the privileged mutation runs.
     */
    recordAuditEvent?: (event: HeddleControlPlaneAuditEvent) => void | Promise<void>;
  };

export type HeddleServerOptions = {
  workspaceRoot: string;
  stateRoot: string;
  preferApiKey?: boolean;
  assetsDir?: string;
  serveAssets?: boolean;
  logger?: Logger;
  runtimeHost?: HeddleRuntimeHostDescriptor;
  accessControl?: HeddleServerAccessControl;
};

export type HeddleControlPlaneServerOptions = Omit<HeddleServerOptions, 'runtimeHost'> & {
  mode: ControlPlaneServerRecord['mode'];
  host: string;
  port: number;
  daemonRegistryPath?: string;
  serverId?: string;
  heartbeatScheduler?: HeddleHeartbeatSchedulerSettings;
};

export type HeddleHeartbeatSchedulerSettings = {
  enabled?: boolean;
  pollIntervalMs?: number;
};

export type HeddleRuntimeHostDescriptor = {
  mode: ControlPlaneServerRecord['mode'];
  serverId: string;
  registryPath: string;
  endpoint: {
    host: string;
    port: number;
  };
  startedAt: string;
};

export type HeddleRuntimeHostInfo = HeddleRuntimeHostDescriptor;

export type HeddleControlPlaneServerHandle = {
  mode: ControlPlaneServerRecord['mode'];
  serverId: string;
  host: string;
  port: number;
  endpoint: {
    host: string;
    port: number;
  };
  registryPath: string;
  workspaceRoot: string;
  stateRoot: string;
  startedAt: string;
  close: () => Promise<void>;
};

export type HeddleServerContext = {
  workspaceRoot: string;
  stateRoot: string;
  preferApiKey: boolean;
  activeWorkspaceId: string;
  activeWorkspace: WorkspaceDescriptor;
  workspaces: WorkspaceDescriptor[];
  runtimeHost: HeddleRuntimeHostInfo | null;
  logger: Logger;
  requestAccess: HeddleServerRequestAccess;
  authorizeControlPlaneOperation?: (
    authorization: HeddleControlPlaneOperationAuthorization,
  ) => void | Promise<void>;
  recordControlPlaneAuditEvent?: (event: HeddleControlPlaneAuditEvent) => void | Promise<void>;
};
