import { readDaemonWorkspaceRegistration, resolveDaemonRegistryPath } from './daemon-registry.js';
import { resolveWorkspaceContext } from './workspaces.js';

const DEFAULT_STALE_AFTER_MS = 45_000;

export type ResolvedRuntimeHost =
  | {
      kind: 'none';
      registryPath: string;
      workspaceId: string;
    }
  | {
      kind: 'daemon';
      registryPath: string;
      workspaceId: string;
      ownerId: string;
      endpoint: {
        host: string;
        port: number;
      };
      startedAt: string;
      lastSeenAt: string;
      stale: boolean;
      ageMs: number;
    };

export function resolveWorkspaceRuntimeHost(options: {
  workspaceRoot: string;
  stateRoot: string;
  registryPath?: string;
  now?: number;
  staleAfterMs?: number;
  isPidAlive?: (pid: number) => boolean;
}): ResolvedRuntimeHost {
  const workspace = resolveWorkspaceContext({
    workspaceRoot: options.workspaceRoot,
    stateRoot: options.stateRoot,
  }).activeWorkspace;
  const registryPath = options.registryPath ?? resolveDaemonRegistryPath();
  const registration = readDaemonWorkspaceRegistration(registryPath, workspace.id);
  const owner = registration?.owner;

  if (!owner) {
    return {
      kind: 'none',
      registryPath,
      workspaceId: workspace.id,
    };
  }

  const now = options.now ?? Date.now();
  const lastSeenAt = Date.parse(owner.lastSeenAt);
  const ageMs = Number.isFinite(lastSeenAt) ? Math.max(0, now - lastSeenAt) : Number.POSITIVE_INFINITY;
  const staleByAge = ageMs > (options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS);
  const pidAlive = owner.pid > 0 ? (options.isPidAlive ?? isPidAlive)(owner.pid) : true;
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

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === 'EPERM') {
      return true;
    }
    return false;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error;
}

export function formatRuntimeHostNotice(command: string, host: ResolvedRuntimeHost): string | undefined {
  if (host.kind !== 'daemon' || host.stale) {
    return undefined;
  }

  return [
    `Heddle notice: workspace is currently owned by a daemon for \`${command}\`.`,
    `daemon=http://${host.endpoint.host}:${host.endpoint.port}`,
    `workspace=${host.workspaceId}`,
  ].join(' ');
}

export function embeddedCommandConflictMessage(command: string, host: ResolvedRuntimeHost): string | undefined {
  if (host.kind !== 'daemon' || host.stale) {
    return undefined;
  }

  return [
    `Workspace ${host.workspaceId} is currently owned by a live Heddle daemon.`,
    `Refusing embedded \`${command}\` to avoid conflicting runtime owners.`,
    `daemon=http://${host.endpoint.host}:${host.endpoint.port}`,
    'Use the daemon-backed control plane, stop the daemon, or rerun with `--force-owner-conflict`.',
  ].join(' ');
}

export function daemonStartConflictMessage(host: ResolvedRuntimeHost): string | undefined {
  if (host.kind !== 'daemon' || host.stale) {
    return undefined;
  }

  return [
    `Workspace ${host.workspaceId} is already owned by a live Heddle daemon.`,
    `Refusing to start a second daemon.`,
    `daemon=http://${host.endpoint.host}:${host.endpoint.port}`,
    'Stop the existing daemon first or rerun with `--force-owner-conflict`.',
  ].join(' ');
}
