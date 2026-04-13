import type { CyberLoopDriftLevel } from '../../../index.js';

export type DriftFooterColor = 'yellow' | 'red' | undefined;

export function formatDriftFooter(enabled: boolean, level: CyberLoopDriftLevel, error: string | undefined): string {
  if (!enabled) {
    return 'off';
  }

  return error ? 'unavailable' : level;
}

export function driftFooterColor(enabled: boolean, level: CyberLoopDriftLevel, error: string | undefined): DriftFooterColor {
  if (!enabled || error) {
    return undefined;
  }

  if (level === 'medium') {
    return 'yellow';
  }

  if (level === 'high') {
    return 'red';
  }

  return undefined;
}
