import type { ControlPlaneSessionStoreSnapshot } from '../../state/control-plane-session-store.js';
import type { ControlPlaneSessionLatestUpdate } from './session-activity-service.js';

export type PromptActivityView = {
  text: string;
  color: 'blue' | 'green' | 'yellow' | 'red';
};

/**
 * Builds the single TUI prompt activity line from cli-v2 session state.
 */
export class PromptActivityService {
  static build(snapshot: ControlPlaneSessionStoreSnapshot): PromptActivityView | undefined {
    const status = snapshot.error ?? snapshot.liveStatus;
    const latestUpdateText = PromptActivityService.formatLatestUpdate(snapshot.latestUpdate);

    if (snapshot.error) {
      return { text: `Error: ${snapshot.error}`, color: 'red' };
    }

    if (latestUpdateText) {
      return { text: latestUpdateText, color: PromptActivityService.getLatestUpdateColor(snapshot.latestUpdate) };
    }

    return status ? { text: `Status: ${status}`, color: 'yellow' } : undefined;
  }

  private static formatLatestUpdate(update: ControlPlaneSessionLatestUpdate | undefined): string | undefined {
    if (!update) {
      return undefined;
    }

    return update.detail ? `Latest: ${update.label} · ${update.detail}` : `Latest: ${update.label}`;
  }

  private static getLatestUpdateColor(update: ControlPlaneSessionLatestUpdate | undefined): PromptActivityView['color'] {
    const colors = {
      info: 'blue',
      success: 'green',
      warning: 'yellow',
      error: 'red',
    } as const;

    return colors[update?.tone ?? 'info'];
  }
}
