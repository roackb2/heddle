import type { ControlPlaneState } from '../../../../lib/api';

export function formatDriftLabel(
  enabled: boolean | undefined,
  level: ControlPlaneState['sessions'][number]['driftLevel'],
): string {
  if (!enabled) {
    return 'drift off';
  }

  return `drift ${level ?? 'unknown'}`;
}
