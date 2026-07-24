import type { Request } from 'express';
import type { Logger } from 'pino';
import { RuntimeWorkspaceService } from '@/core/runtime/workspaces/index.js';
import type { HeddleServerRequestAccessService } from '@/server/access/index.js';
import { getWorkspaceOperationLogger } from '@/server/logging/workspace-operation-logger.js';
import { createRequestLoggingMiddleware } from './request-logging.js';

type WorkspaceRequestLoggingOptions = {
  workspaceRoot: string;
  stateRoot: string;
  logger: Logger;
  requestAccess?: HeddleServerRequestAccessService;
};

export function createWorkspaceRequestLoggingMiddleware(options: WorkspaceRequestLoggingOptions) {
  return createRequestLoggingMiddleware({
    logger: options.logger,
    resolveLogger: (request) => resolveWorkspaceRequestLogger({ ...options, request }),
  });
}

function resolveWorkspaceRequestLogger(options: WorkspaceRequestLoggingOptions & { request: Request }): Logger {
  try {
    const workspaceId = readWorkspaceIdFromRequest(options.request);
    if (options.requestAccess) {
      return getWorkspaceOperationLogger(
        options.requestAccess.resolveWorkspace(options.request, workspaceId).stateRoot,
      );
    }

    const workspaceContext = RuntimeWorkspaceService.resolveContext({
      workspaceRoot: options.workspaceRoot,
      stateRoot: options.stateRoot,
    });
    const workspace =
      workspaceId ?
        workspaceContext.workspaces.find((candidate) => candidate.id === workspaceId)
      : workspaceContext.activeWorkspace;
    return workspace ? getWorkspaceOperationLogger(workspace.stateRoot) : options.logger;
  } catch {
    return options.logger;
  }
}

function readWorkspaceIdFromRequest(request: Request): string | undefined {
  const explicitWorkspaceId = readStringValue(request.query.workspaceId);
  if (explicitWorkspaceId) {
    return explicitWorkspaceId;
  }

  const rawInput = readStringValue(request.query.input);
  if (!rawInput) {
    return undefined;
  }

  try {
    return readWorkspaceIdFromUnknown(JSON.parse(rawInput));
  } catch {
    return undefined;
  }
}

function readWorkspaceIdFromUnknown(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  if (Array.isArray(value)) {
    return value.map(readWorkspaceIdFromUnknown).find(Boolean);
  }

  const record = value as Record<string, unknown>;
  const directWorkspaceId = readStringValue(record.workspaceId);
  if (directWorkspaceId) {
    return directWorkspaceId;
  }

  return Object.values(record).map(readWorkspaceIdFromUnknown).find(Boolean);
}

function readStringValue(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed || undefined;
}
