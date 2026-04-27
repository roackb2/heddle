import { resolve } from 'node:path';
import type { HeddleServerContext } from '../../../types.js';
import type { ControlPlaneState } from '../types.js';
import { readDaemonRegistry, registerKnownWorkspaces, resolveDaemonRegistryPath } from '../../../../core/runtime/daemon-registry.js';
import { resolveProviderCredentialSourceForModel } from '../../../../core/runtime/api-keys.js';
import { readChatSessionViews } from './chat-sessions.js';
import { listControlPlaneHeartbeatRuns, listControlPlaneHeartbeatTasks } from './heartbeat.js';
import { readControlPlaneMemoryStatus } from './memory.js';

export async function loadControlPlaneState(context: HeddleServerContext): Promise<ControlPlaneState> {
  const workspaceRoot = context.activeWorkspace.anchorRoot;
  const stateRoot = context.activeWorkspace.stateRoot;
  const [tasks, runs, memory] = await Promise.all([
    listControlPlaneHeartbeatTasks(stateRoot),
    listControlPlaneHeartbeatRuns(stateRoot, { limit: 20 }),
    readControlPlaneMemoryStatus(stateRoot),
  ]);

  return {
    workspaceRoot,
    stateRoot,
    auth: {
      preferApiKey: context.preferApiKey,
      openai: resolveProviderCredentialSourceForModel('gpt-5.4', { preferApiKey: context.preferApiKey }),
      anthropic: resolveProviderCredentialSourceForModel('claude-sonnet-4-6', { preferApiKey: context.preferApiKey }),
    },
    activeWorkspaceId: context.activeWorkspaceId,
    workspace: context.activeWorkspace,
    workspaces: context.workspaces,
    knownWorkspaces: readKnownWorkspaces(context),
    runtimeHost: context.runtimeHost,
    sessions: readChatSessionViews(resolve(stateRoot, 'chat-sessions.catalog.json')),
    heartbeat: {
      tasks,
      runs,
    },
    memory,
  };
}

function readKnownWorkspaces(context: HeddleServerContext): ControlPlaneState['knownWorkspaces'] {
  const registryPath = context.runtimeHost?.registryPath ?? resolveDaemonRegistryPath();
  registerKnownWorkspaces({
    registryPath,
    workspaces: context.workspaces,
  });
  const current = new Set(context.workspaces.map((workspace) => resolve(workspace.stateRoot)));
  const known = new Map<string, ControlPlaneState['knownWorkspaces'][number]>();
  for (const record of readDaemonRegistry(registryPath).workspaces) {
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
