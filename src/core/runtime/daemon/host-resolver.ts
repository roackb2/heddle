/**
 * Runtime host resolver.
 *
 * Resolves whether the current workspace has a live daemon owner. This is
 * daemon-discovery policy, not CLI/web presentation.
 */
import { FileDaemonRegistryRepository } from './registry-repository.js';
import { RuntimeDaemonRegistryService } from './registry-service.js';
import type { ResolvedRuntimeHost, ResolveRuntimeHostInput } from './types.js';
import { RuntimeWorkspaceService } from '@/core/runtime/workspaces/index.js';

const DEFAULT_STALE_AFTER_MS = 45_000;

export class RuntimeHostResolver {
  static resolveWorkspaceHost(input: ResolveRuntimeHostInput): ResolvedRuntimeHost {
    const workspace = RuntimeWorkspaceService.resolveContext(input).activeWorkspace;
    const registryPath = input.registryPath ?? FileDaemonRegistryRepository.resolvePath();
    const registration = RuntimeDaemonRegistryService.readWorkspaceRegistration(
      registryPath,
      workspace.id,
      workspace.stateRoot,
    );
    const owner = registration?.owner;

    if (!owner) {
      return {
        kind: 'none',
        registryPath,
        workspaceId: workspace.id,
      };
    }

    const now = input.now ?? Date.now();
    const lastSeenAt = Date.parse(owner.lastSeenAt);
    const ageMs = Number.isFinite(lastSeenAt) ? Math.max(0, now - lastSeenAt) : Number.POSITIVE_INFINITY;
    const staleByAge = ageMs > (input.staleAfterMs ?? DEFAULT_STALE_AFTER_MS);
    const pidAlive = owner.pid > 0 ? (input.isPidAlive ?? RuntimeHostResolver.isPidAlive)(owner.pid) : true;
    const stale = staleByAge || !pidAlive;

    return {
      kind: 'daemon',
      registryPath,
      workspaceId: workspace.id,
      ownerId: owner.ownerId,
      endpoint: {
        host: owner.host,
        port: owner.port,
      },
      startedAt: owner.startedAt,
      lastSeenAt: owner.lastSeenAt,
      stale,
      ageMs,
    };
  }

  private static isPidAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      if (RuntimeHostResolver.isNodeError(error) && error.code === 'EPERM') {
        return true;
      }
      return false;
    }
  }

  private static isNodeError(error: unknown): error is NodeJS.ErrnoException {
    return typeof error === 'object' && error !== null && 'code' in error;
  }
}
