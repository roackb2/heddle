import dayjs from 'dayjs';
import type { ControlPlaneSessionView } from '../../api/types.js';

/**
 * Owns frontend-neutral implicit session selection.
 *
 * Pinning controls list presentation only. When a client starts without an
 * explicit session, it should resume the session with the newest durable
 * activity timestamp regardless of where that session appears in the list.
 */
export class ClientSharedSessionSelectionService {
  static resolveStartupSession(
    sessions: readonly ControlPlaneSessionView[],
  ): ControlPlaneSessionView | undefined {
    return sessions.reduce<ControlPlaneSessionView | undefined>((latest, candidate) => {
      if (!latest) {
        return candidate;
      }

      const candidateTimestamp = ClientSharedSessionSelectionService.activityTimestamp(candidate);
      const latestTimestamp = ClientSharedSessionSelectionService.activityTimestamp(latest);
      if (candidateTimestamp !== latestTimestamp) {
        return candidateTimestamp > latestTimestamp ? candidate : latest;
      }

      return candidate.id < latest.id ? candidate : latest;
    }, undefined);
  }

  private static activityTimestamp(session: ControlPlaneSessionView): number {
    for (const timestamp of [session.updatedAt, session.createdAt]) {
      const parsed = timestamp ? dayjs(timestamp) : undefined;
      if (parsed?.isValid()) {
        return parsed.valueOf();
      }
    }

    return Number.NEGATIVE_INFINITY;
  }
}
