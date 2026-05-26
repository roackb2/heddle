import type {
  ControlPlaneSessionLatestUpdate,
  ControlPlaneSessionStoreSnapshot,
} from '../../state/control-plane-session-store.js';

export type PromptActivityView = {
  text: string;
  color: 'blue' | 'green' | 'yellow' | 'red';
};

export function buildPromptActivity(snapshot: ControlPlaneSessionStoreSnapshot): PromptActivityView | undefined {
  const status = snapshot.error ?? snapshot.liveStatus;
  const latestUpdateText = formatLatestUpdate(snapshot.latestUpdate);

  if (snapshot.error) {
    return { text: `Error: ${snapshot.error}`, color: 'red' };
  }

  if (latestUpdateText) {
    return { text: latestUpdateText, color: getLatestUpdateColor(snapshot.latestUpdate) };
  }

  return status ? { text: `Status: ${status}`, color: 'yellow' } : undefined;
}

function formatLatestUpdate(update: ControlPlaneSessionLatestUpdate | undefined): string | undefined {
  if (!update) {
    return undefined;
  }

  return update.detail ? `Latest: ${update.label} · ${update.detail}` : `Latest: ${update.label}`;
}

function getLatestUpdateColor(update: ControlPlaneSessionLatestUpdate | undefined): PromptActivityView['color'] {
  const colors = {
    info: 'blue',
    success: 'green',
    warning: 'yellow',
    error: 'red',
  } as const;

  return colors[update?.tone ?? 'info'];
}
