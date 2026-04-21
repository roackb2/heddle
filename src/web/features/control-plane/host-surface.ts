import type { ControlPlaneState } from '../../lib/api';

const STALE_AFTER_MS = 45_000;

export type RuntimeHostSurface = {
  state: 'attached' | 'stale' | 'local';
  label: string;
  badgeLabel: string;
  detail: string;
  tone: 'secondary' | 'outline' | 'destructive';
  endpoint?: string;
  ownerId?: string;
  lastSeenAt?: string;
};

export function projectRuntimeHostSurface(state?: ControlPlaneState): RuntimeHostSurface {
  if (!state?.runtimeHost) {
    return {
      state: 'local',
      label: 'Local control plane',
      badgeLabel: 'Local',
      detail: 'No daemon ownership metadata is loaded in this control-plane session.',
      tone: 'outline',
    };
  }

  const lastSeenAt = state.runtimeHost.workspaceOwner?.lastSeenAt;
  const stale = isStale(lastSeenAt);
  const endpoint = `${state.runtimeHost.endpoint.host}:${state.runtimeHost.endpoint.port}`;

  if (stale) {
    return {
      state: 'stale',
      label: 'Daemon unreachable',
      badgeLabel: 'Stale daemon',
      detail: lastSeenAt ?
        `The last daemon heartbeat is stale for ${state.workspace.name}. Refresh state or restart the daemon before trusting live runtime status.`
      : `The daemon owner for ${state.workspace.name} is not reporting a recent heartbeat.`,
      tone: 'destructive',
      endpoint,
      ownerId: state.runtimeHost.ownerId,
      lastSeenAt,
    };
  }

  return {
    state: 'attached',
    label: 'Attached to daemon',
    badgeLabel: 'Daemon',
    detail: `Sessions and tasks are reading daemon-owned runtime state for ${state.workspace.name}.`,
    tone: 'secondary',
    endpoint,
    ownerId: state.runtimeHost.ownerId,
    lastSeenAt,
  };
}

function isStale(lastSeenAt: string | undefined): boolean {
  if (!lastSeenAt) {
    return false;
  }
  const parsed = Date.parse(lastSeenAt);
  if (!Number.isFinite(parsed)) {
    return false;
  }
  return Date.now() - parsed > STALE_AFTER_MS;
}
