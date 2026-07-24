import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { Logger } from 'pino';
import {
  FileDaemonRegistryRepository,
  RuntimeDaemonRegistryService,
} from '@/core/runtime/daemon/index.js';
import {
  RuntimeWorkspaceService,
  type ResolvedWorkspaceContext,
  type WorkspaceDescriptor,
} from '@/core/runtime/workspaces/index.js';
import type {
  HeddleControlPlaneAuditEvent,
  HeddleControlPlaneOperation,
  HeddleServerAccessControl,
  HeddleServerHostedRequestAccess,
  HeddleServerRequestAccess,
  HeddleServerWorkspaceScope,
} from '@/server/types.js';

type HeddleServerRequestAccessServiceOptions = {
  workspaceRoot: string;
  stateRoot: string;
  registryPath?: string;
  logger: Logger;
  accessControl?: HeddleServerAccessControl;
};

export class HeddleServerAccessError extends Error {
  constructor(
    readonly statusCode: 401 | 403,
    message: string,
  ) {
    super(message);
    this.name = 'HeddleServerAccessError';
  }
}

/**
 * Owns the HTTP request access boundary for the reference control plane.
 *
 * Hosted products authenticate requests and resolve product identity before
 * Heddle handlers run. Heddle then enforces the returned workspace/session
 * scope consistently across tRPC and REST transports.
 */
export class HeddleServerRequestAccessService {
  private readonly requestAccess = new WeakMap<Request, HeddleServerRequestAccess>();
  private readonly accessControl: HeddleServerAccessControl;

  constructor(private readonly options: HeddleServerRequestAccessServiceOptions) {
    this.accessControl = options.accessControl ?? { mode: 'local' };
  }

  get mode(): HeddleServerAccessControl['mode'] {
    return this.accessControl.mode;
  }

  createMiddleware(): RequestHandler {
    return (request: Request, response: Response, next: NextFunction): void => {
      void this.bind(request)
        .then(() => next())
        .catch((error: unknown) => this.rejectRequest(response, error));
    };
  }

  requireAccess(request: Request): HeddleServerRequestAccess {
    const access = this.requestAccess.get(request);
    if (!access) {
      throw new Error('Control-plane request access was not resolved before the handler ran.');
    }
    return access;
  }

  resolveWorkspaceContext(request: Request): ResolvedWorkspaceContext {
    const access = this.requireAccess(request);
    const context = RuntimeWorkspaceService.resolveContext({
      workspaceRoot: this.options.workspaceRoot,
      stateRoot: this.options.stateRoot,
    });
    if (access.mode === 'local') {
      return context;
    }

    const workspaces = access.scope.workspaces.map((scope) => (
      this.requireWorkspaceDescriptor(context, scope.workspaceId)
    ));
    const activeWorkspace =
      workspaces.find((workspace) => workspace.id === context.activeWorkspaceId)
      ?? workspaces[0];
    if (!activeWorkspace) {
      throw new HeddleServerAccessError(403, 'The authenticated principal has no permitted workspace.');
    }

    return {
      catalogPath: context.catalogPath,
      catalog: {
        ...context.catalog,
        activeWorkspaceId: activeWorkspace.id,
        workspaces,
      },
      activeWorkspaceId: activeWorkspace.id,
      activeWorkspace,
      workspaces,
    };
  }

  resolveWorkspace(request: Request, requestedWorkspaceId?: string): WorkspaceDescriptor {
    const access = this.requireAccess(request);
    const context = RuntimeWorkspaceService.resolveContext({
      workspaceRoot: this.options.workspaceRoot,
      stateRoot: this.options.stateRoot,
    });
    const workspaceId = requestedWorkspaceId ?? this.resolveDefaultWorkspaceId(access, context);
    assertHeddleServerWorkspaceAccess(access, workspaceId);
    return this.requireWorkspaceDescriptor(context, workspaceId);
  }

  async authorizeOperation(request: Request, operation: HeddleControlPlaneOperation): Promise<void> {
    const access = this.requireAccess(request);
    if (operation.workspaceId) {
      assertHeddleServerWorkspaceAccess(access, operation.workspaceId);
    }
    if (operation.workspaceId && operation.sessionId) {
      assertHeddleServerSessionAccess(access, operation.workspaceId, operation.sessionId);
    }
    if (this.accessControl.mode === 'hosted') {
      await this.accessControl.authorizeOperation?.({ access, operation });
    }
  }

  async recordAuditEvent(event: HeddleControlPlaneAuditEvent): Promise<void> {
    if (this.accessControl.mode === 'hosted') {
      await this.accessControl.recordAuditEvent?.(event);
    }
  }

  private async bind(request: Request): Promise<void> {
    const access = await this.resolveRequestAccess(request);
    this.requestAccess.set(request, access);
  }

  private async resolveRequestAccess(request: Request): Promise<HeddleServerRequestAccess> {
    if (this.accessControl.mode === 'local') {
      return createLocalHeddleServerRequestAccess();
    }

    const resolved = await this.accessControl.resolveRequestAccess(request);
    if (!resolved) {
      throw new HeddleServerAccessError(401, 'Authentication required.');
    }
    return normalizeHostedRequestAccess(resolved);
  }

  private resolveDefaultWorkspaceId(
    access: HeddleServerRequestAccess,
    context: ResolvedWorkspaceContext,
  ): string {
    if (access.mode === 'local') {
      return context.activeWorkspaceId;
    }

    return access.scope.workspaces.find((scope) => scope.workspaceId === context.activeWorkspaceId)?.workspaceId
      ?? access.scope.workspaces[0]?.workspaceId
      ?? '';
  }

  private requireWorkspaceDescriptor(
    context: ResolvedWorkspaceContext,
    workspaceId: string,
  ): WorkspaceDescriptor {
    const workspace =
      context.workspaces.find((candidate) => candidate.id === workspaceId)
      ?? RuntimeDaemonRegistryService.readWorkspaceRegistration(
        this.options.registryPath ?? FileDaemonRegistryRepository.resolvePath(),
        workspaceId,
      )?.workspace;
    if (!workspace) {
      throw new HeddleServerAccessError(403, 'The requested workspace is not available to this server.');
    }
    return workspace;
  }

  private rejectRequest(response: Response, error: unknown): void {
    if (error instanceof HeddleServerAccessError) {
      this.options.logger.warn({
        statusCode: error.statusCode,
        error: error.message,
      }, 'Control-plane request rejected by access boundary');
      response.status(error.statusCode).json({ error: error.message });
      return;
    }

    this.options.logger.error({ error }, 'Control-plane request authentication failed');
    response.status(500).json({ error: 'Control-plane request authentication failed.' });
  }
}

export function createLocalHeddleServerRequestAccess(): HeddleServerRequestAccess {
  return {
    mode: 'local',
    principal: {
      id: 'local-operator',
      displayName: 'Local operator',
      auditMetadata: {
        authentication: 'none',
      },
    },
    scope: {
      workspaces: 'all',
    },
  };
}

export function assertHeddleServerWorkspaceAccess(
  access: HeddleServerRequestAccess,
  workspaceId: string,
): void {
  if (access.mode === 'local') {
    return;
  }
  if (!findWorkspaceScope(access, workspaceId)) {
    throw new HeddleServerAccessError(403, 'The authenticated principal cannot access the requested workspace.');
  }
}

export function assertHeddleServerSessionAccess(
  access: HeddleServerRequestAccess,
  workspaceId: string,
  sessionId: string,
): void {
  if (access.mode === 'local') {
    return;
  }

  const workspaceScope = findWorkspaceScope(access, workspaceId);
  if (!workspaceScope) {
    throw new HeddleServerAccessError(403, 'The authenticated principal cannot access the requested workspace.');
  }
  if (workspaceScope.sessionIds && !workspaceScope.sessionIds.includes(sessionId)) {
    throw new HeddleServerAccessError(403, 'The authenticated principal cannot access the requested session.');
  }
}

export function resolveHeddleServerPermittedSessionIds(
  access: HeddleServerRequestAccess,
  workspaceId: string,
): readonly string[] | undefined {
  if (access.mode === 'local') {
    return undefined;
  }

  const workspaceScope = findWorkspaceScope(access, workspaceId);
  if (!workspaceScope) {
    throw new HeddleServerAccessError(403, 'The authenticated principal cannot access the requested workspace.');
  }
  return workspaceScope.sessionIds;
}

function normalizeHostedRequestAccess(
  access: HeddleServerHostedRequestAccess,
): HeddleServerRequestAccess {
  const principalId = access.principal.id.trim();
  if (!principalId) {
    throw new Error('Hosted request access requires a non-empty principal ID.');
  }

  const workspaces = access.scope.workspaces.map(normalizeWorkspaceScope);
  if (!workspaces.length) {
    throw new HeddleServerAccessError(403, 'The authenticated principal has no permitted workspace.');
  }
  if (new Set(workspaces.map((scope) => scope.workspaceId)).size !== workspaces.length) {
    throw new Error('Hosted request access contains duplicate workspace scopes.');
  }

  return {
    mode: 'hosted',
    principal: {
      ...access.principal,
      id: principalId,
    },
    scope: {
      workspaces,
    },
  };
}

function normalizeWorkspaceScope(scope: HeddleServerWorkspaceScope): HeddleServerWorkspaceScope {
  const workspaceId = scope.workspaceId.trim();
  if (!workspaceId) {
    throw new Error('Hosted request access contains an empty workspace ID.');
  }

  const sessionIds = scope.sessionIds?.map((sessionId) => sessionId.trim());
  if (sessionIds?.some((sessionId) => !sessionId)) {
    throw new Error(`Hosted request access contains an empty session ID for workspace ${workspaceId}.`);
  }
  if (sessionIds && new Set(sessionIds).size !== sessionIds.length) {
    throw new Error(`Hosted request access contains duplicate session IDs for workspace ${workspaceId}.`);
  }

  return {
    workspaceId,
    sessionIds,
  };
}

function findWorkspaceScope(
  access: Extract<HeddleServerRequestAccess, { mode: 'hosted' }>,
  workspaceId: string,
): HeddleServerWorkspaceScope | undefined {
  return access.scope.workspaces.find((scope) => scope.workspaceId === workspaceId);
}
