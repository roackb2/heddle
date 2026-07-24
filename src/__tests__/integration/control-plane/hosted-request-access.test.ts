import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createTRPCProxyClient,
  httpLink,
  TRPCClientError,
} from '@trpc/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatSessionRecords } from '@/core/chat/engine/sessions/records/index.js';
import { FileChatSessionRepository } from '@/core/chat/engine/sessions/repository/index.js';
import { RuntimeWorkspaceService, type WorkspaceDescriptor } from '@/core/runtime/workspaces/index.js';
import { createHeddleServerApp } from '@/server/app.js';
import { controlPlaneChatSessionsController } from '@/server/controllers/trpc/control-plane/chat-sessions-controller.js';
import type { AppRouter } from '@/server/router.js';
import type {
  HeddleControlPlaneAuditEvent,
  HeddleControlPlaneOperationAuthorization,
} from '@/server/types.js';

const AUTHORIZATION = 'Bearer hosted-test-token';
const openServers = new Set<Server>();

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(Array.from(openServers, closeServer));
  openServers.clear();
});

describe('hosted control-plane request access', () => {
  it('authenticates before handlers and prevents client workspace IDs from broadening host scope', async () => {
    const fixture = await createHostedFixture();

    const unauthenticated = await fetch(`${fixture.baseUrl}/trpc/health`);
    expect(unauthenticated.status).toBe(401);

    const health = await fixture.client.health.query();
    expect(health.workspaces.map((workspace) => workspace.id)).toEqual([fixture.primaryWorkspace.id]);

    const state = await fixture.client.controlPlane.state.query({
      workspaceId: fixture.primaryWorkspace.id,
    });
    expect(state.workspaces.map((workspace) => workspace.id)).toEqual([fixture.primaryWorkspace.id]);
    expect(state.knownWorkspaces).toEqual([]);

    await expectForbidden(fixture.client.controlPlane.sessions.query({
      workspaceId: fixture.secondaryWorkspace.id,
    }));
    await expectForbidden(fixture.client.controlPlane.workspaceBrowse.query({}));
  });

  it('filters session catalogs and applies the same session scope to tRPC and REST', async () => {
    const fixture = await createHostedFixture();

    const sessions = await fixture.client.controlPlane.sessions.query({
      workspaceId: fixture.primaryWorkspace.id,
    });
    expect(sessions.sessions.map((session) => session.id)).toEqual([fixture.permittedSessionId]);

    const state = await fixture.client.controlPlane.state.query({
      workspaceId: fixture.primaryWorkspace.id,
    });
    expect(state.sessions.map((session) => session.id)).toEqual([fixture.permittedSessionId]);

    await expectForbidden(fixture.client.controlPlane.session.query({
      workspaceId: fixture.primaryWorkspace.id,
      id: fixture.deniedSessionId,
    }));
    await expectForbidden(fixture.client.controlPlane.sessionCreate.mutate({
      workspaceId: fixture.primaryWorkspace.id,
      name: 'Not in the resolved scope',
    }));

    const upload = new FormData();
    upload.append('images', new Blob(['fake-png'], { type: 'image/png' }), 'screen.png');
    const response = await fetch(
      `${fixture.baseUrl}/control-plane/sessions/${fixture.deniedSessionId}/uploads?workspaceId=${fixture.primaryWorkspace.id}`,
      {
        method: 'POST',
        headers: {
          authorization: AUTHORIZATION,
        },
        body: upload,
      },
    );
    expect(response.status).toBe(403);
  });

  it('authorizes privileged operations and records the authenticated approval actor before mutation', async () => {
    const sequence: string[] = [];
    const fixture = await createHostedFixture({
      authorizeOperation: (authorization) => {
        sequence.push(`authorize:${authorization.operation.name}`);
      },
      recordAuditEvent: (event) => {
        sequence.push(`audit:${event.operation}`);
      },
    });
    vi.spyOn(controlPlaneChatSessionsController, 'resolvePendingApproval').mockImplementation(() => {
      sequence.push('mutate:approval.resolve');
      return true;
    });
    vi.spyOn(controlPlaneChatSessionsController, 'cancelRun').mockImplementation(() => {
      sequence.push('mutate:run.cancel');
      return true;
    });

    await expect(fixture.client.controlPlane.sessionResolveApproval.mutate({
      workspaceId: fixture.primaryWorkspace.id,
      sessionId: fixture.permittedSessionId,
      runId: 'run-approval',
      decision: {
        type: 'approve',
        reason: 'Reviewed by the product user.',
      },
    })).resolves.toEqual({ resolved: true });
    await expect(fixture.client.controlPlane.sessionCancel.mutate({
      workspaceId: fixture.primaryWorkspace.id,
      id: fixture.permittedSessionId,
      runId: 'run-cancel',
    })).resolves.toEqual({ cancelled: true });

    expect(sequence).toEqual([
      'authorize:sessionResolveApproval',
      'audit:approval.resolve',
      'mutate:approval.resolve',
      'authorize:sessionCancel',
      'audit:run.cancel',
      'mutate:run.cancel',
    ]);
    expect(fixture.authorizations.map(({ access, operation }) => ({
      actorId: access.principal.id,
      workspaceId: operation.workspaceId,
      sessionId: operation.sessionId,
    }))).toEqual([
      {
        actorId: 'product-user-1',
        workspaceId: fixture.primaryWorkspace.id,
        sessionId: fixture.permittedSessionId,
      },
      {
        actorId: 'product-user-1',
        workspaceId: fixture.primaryWorkspace.id,
        sessionId: fixture.permittedSessionId,
      },
    ]);
    expect(fixture.auditEvents).toEqual([
      expect.objectContaining({
        operation: 'approval.resolve',
        actor: expect.objectContaining({
          id: 'product-user-1',
          auditMetadata: { tenantId: 'tenant-1' },
        }),
        workspaceId: fixture.primaryWorkspace.id,
        sessionId: fixture.permittedSessionId,
        runId: 'run-approval',
        metadata: {
          decisionType: 'approve',
          reason: 'Reviewed by the product user.',
        },
      }),
      expect.objectContaining({
        operation: 'run.cancel',
        actor: expect.objectContaining({ id: 'product-user-1' }),
        workspaceId: fixture.primaryWorkspace.id,
        sessionId: fixture.permittedSessionId,
        runId: 'run-cancel',
      }),
    ]);
  });
});

type HostedFixtureOptions = {
  authorizeOperation?: (authorization: HeddleControlPlaneOperationAuthorization) => void;
  recordAuditEvent?: (event: HeddleControlPlaneAuditEvent) => void;
};

async function createHostedFixture(options: HostedFixtureOptions = {}) {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-hosted-access-'));
  const stateRoot = join(workspaceRoot, '.heddle');
  RuntimeWorkspaceService.ensureCatalog({ workspaceRoot, stateRoot });
  const secondaryWorkspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-hosted-access-secondary-'));
  const resolved = RuntimeWorkspaceService.createDescriptor({
    workspaceRoot,
    stateRoot,
    name: 'Secondary workspace',
    newWorkspaceRoot: secondaryWorkspaceRoot,
    workspaceStateRoot: join(secondaryWorkspaceRoot, '.heddle'),
    nextId: 'workspace-secondary',
    setActive: false,
  });
  const primaryWorkspace = requireWorkspace(resolved.workspaces, resolved.activeWorkspaceId);
  const secondaryWorkspace = requireWorkspace(resolved.workspaces, 'workspace-secondary');
  const permittedSessionId = 'session-permitted';
  const deniedSessionId = 'session-denied';
  await createSession(primaryWorkspace, permittedSessionId);
  await createSession(primaryWorkspace, deniedSessionId);

  const authorizations: HeddleControlPlaneOperationAuthorization[] = [];
  const auditEvents: HeddleControlPlaneAuditEvent[] = [];
  const app = createHeddleServerApp({
    workspaceRoot,
    stateRoot,
    serveAssets: false,
    accessControl: {
      mode: 'hosted',
      resolveRequestAccess(request) {
        if (request.header('authorization') !== AUTHORIZATION) {
          return null;
        }
        return {
          principal: {
            id: 'product-user-1',
            auditMetadata: {
              tenantId: 'tenant-1',
            },
          },
          scope: {
            workspaces: [{
              workspaceId: primaryWorkspace.id,
              sessionIds: [permittedSessionId],
            }],
          },
        };
      },
      authorizeOperation(authorization) {
        authorizations.push(authorization);
        options.authorizeOperation?.(authorization);
      },
      recordAuditEvent(event) {
        auditEvents.push(event);
        options.recordAuditEvent?.(event);
      },
    },
  });
  const server = app.listen(0, '127.0.0.1');
  openServers.add(server);
  await onceListening(server);
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const client = createTRPCProxyClient<AppRouter>({
    links: [
      httpLink({
        url: `${baseUrl}/trpc`,
        headers: {
          authorization: AUTHORIZATION,
        },
      }),
    ],
  });

  return {
    auditEvents,
    authorizations,
    baseUrl,
    client,
    deniedSessionId,
    permittedSessionId,
    primaryWorkspace,
    secondaryWorkspace,
  };
}

async function createSession(workspace: WorkspaceDescriptor, sessionId: string): Promise<void> {
  await new FileChatSessionRepository({
    sessionStoragePath: join(workspace.stateRoot, 'chat-sessions.catalog.json'),
  }).create(ChatSessionRecords.create({
    id: sessionId,
    name: sessionId,
    apiKeyPresent: true,
    workspaceId: workspace.id,
  }));
}

function requireWorkspace(workspaces: WorkspaceDescriptor[], workspaceId: string): WorkspaceDescriptor {
  const workspace = workspaces.find((candidate) => candidate.id === workspaceId);
  if (!workspace) {
    throw new Error(`Expected workspace: ${workspaceId}`);
  }
  return workspace;
}

async function expectForbidden(result: Promise<unknown>): Promise<void> {
  try {
    await result;
  } catch (error) {
    expect(error).toBeInstanceOf(TRPCClientError);
    expect((error as TRPCClientError<AppRouter>).data?.httpStatus).toBe(403);
    return;
  }
  throw new Error('Expected request to be forbidden.');
}

async function onceListening(server: Server): Promise<void> {
  if (server.listening) {
    return;
  }
  await new Promise<void>((resolve) => {
    server.once('listening', resolve);
  });
}

async function closeServer(server: Server): Promise<void> {
  openServers.delete(server);
  if (!server.listening) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
