import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createLogger } from '@/core/utils/logger.js';
import type { WorkspaceDescriptor } from '@/core/runtime/workspaces/index.js';
import type { HeddleServerContext } from '@/server/types.js';
import { resolveControlPlaneRequestWorkspace } from '@/server/routes/trpc/control-plane-workspace.js';

const silentLogger = createLogger({ level: 'silent', console: false });

describe('resolveControlPlaneRequestWorkspace', () => {
  it('loads workspace autopilot config into session engine args', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-control-plane-workspace-'));
    const stateRoot = join(workspaceRoot, '.heddle');
    mkdirSync(stateRoot, { recursive: true });
    writeFileSync(join(stateRoot, 'config.json'), `${JSON.stringify({
      autopilot: {
        mode: 'autopilot',
        roots: [{
          path: '.',
          access: 'autopilot',
          allow: ['read', 'write', 'execute'],
        }],
        environments: {
          allow: ['local', 'dev'],
          requireApproval: ['staging', 'production', 'unknown'],
        },
      },
    })}\n`);
    const workspace = createWorkspaceDescriptor({ workspaceRoot, stateRoot });

    const resolved = resolveControlPlaneRequestWorkspace(createContext(workspace));

    expect(resolved.sessionEngineArgs.autopilot).toEqual({
      mode: 'autopilot',
      roots: [{
        path: '.',
        access: 'autopilot',
        allow: ['read', 'write', 'execute'],
      }],
      environments: {
        allow: ['local', 'dev'],
        requireApproval: ['staging', 'production', 'unknown'],
      },
    });
  });
});

function createWorkspaceDescriptor(args: {
  workspaceRoot: string;
  stateRoot: string;
}): WorkspaceDescriptor {
  return {
    id: 'workspace-1',
    name: 'Workspace 1',
    workspaceRoot: args.workspaceRoot,
    repoRoots: [args.workspaceRoot],
    stateRoot: args.stateRoot,
    createdAt: '2026-06-08T00:00:00.000Z',
    updatedAt: '2026-06-08T00:00:00.000Z',
  };
}

function createContext(workspace: WorkspaceDescriptor): HeddleServerContext {
  return {
    workspaceRoot: workspace.workspaceRoot,
    stateRoot: workspace.stateRoot,
    preferApiKey: false,
    activeWorkspaceId: workspace.id,
    activeWorkspace: workspace,
    workspaces: [workspace],
    runtimeHost: null,
    logger: silentLogger,
  };
}
