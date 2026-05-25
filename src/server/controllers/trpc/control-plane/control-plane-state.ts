import { resolve } from 'node:path';
import type { HeddleServerContext } from '@/server/types.js';
import type { ControlPlaneState } from '@/server/control-plane-types.js';
import { FileDaemonRegistryRepository, RuntimeDaemonRegistryService } from '@/core/runtime/daemon/index.js';
import type { WorkspaceDescriptor } from '@/core/runtime/workspaces/index.js';
import { RuntimeCredentialService } from '@/core/runtime/credentials/index.js';
import { controlPlaneChatSessionsController } from './chat-sessions-controller.js';
import { ControlPlaneHeartbeatController } from './heartbeat.js';
import { ControlPlaneMemoryController } from './memory.js';

export class ControlPlaneStateController {
  static async load(
    context: HeddleServerContext,
    workspace: WorkspaceDescriptor = context.activeWorkspace,
  ): Promise<ControlPlaneState> {
    const workspaceRoot = workspace.workspaceRoot;
    const stateRoot = workspace.stateRoot;
    const [tasks, memory] = await Promise.all([
      ControlPlaneHeartbeatController.listTasks(stateRoot),
      ControlPlaneMemoryController.readStatus(stateRoot),
    ]);

    return {
      workspaceRoot,
      stateRoot,
      auth: {
        preferApiKey: context.preferApiKey,
        openai: RuntimeCredentialService.resolveCredentialSourceForModel('gpt-5.4', { preferApiKey: context.preferApiKey }),
        anthropic: RuntimeCredentialService.resolveCredentialSourceForModel('claude-sonnet-4-6', { preferApiKey: context.preferApiKey }),
      },
      activeWorkspaceId: workspace.id,
      workspace,
      workspaces: context.workspaces,
      knownWorkspaces: ControlPlaneStateController.readKnownWorkspaces(context),
      runtimeHost: context.runtimeHost,
      sessions: controlPlaneChatSessionsController.readViews({
        workspaceRoot,
        stateRoot,
        sessionStoragePath: resolve(stateRoot, 'chat-sessions.catalog.json'),
        preferApiKey: context.preferApiKey,
        workspaceId: workspace.id,
      }),
      heartbeat: {
        tasks,
        runs: [],
      },
      memory,
    };
  }

  private static readKnownWorkspaces(context: HeddleServerContext): ControlPlaneState['knownWorkspaces'] {
    const registryPath = context.runtimeHost?.registryPath ?? FileDaemonRegistryRepository.resolvePath();
    RuntimeDaemonRegistryService.registerKnownWorkspaces({
      registryPath,
      workspaces: context.workspaces,
    });
    const current = new Set(context.workspaces.map((workspace) => resolve(workspace.stateRoot)));
    const known = new Map<string, ControlPlaneState['knownWorkspaces'][number]>();
    for (const record of RuntimeDaemonRegistryService.read(registryPath).workspaces) {
      const stateRoot = resolve(record.workspace.stateRoot);
      if (current.has(stateRoot)) {
        continue;
      }
      const existing = known.get(stateRoot);
      if (!existing || (record.workspace.updatedAt ?? '') > (existing.updatedAt ?? '')) {
        known.set(stateRoot, record.workspace);
      }
    }
    return Array.from(known.values()).sort((left, right) => (right.updatedAt ?? '').localeCompare(left.updatedAt ?? ''));
  }
}
