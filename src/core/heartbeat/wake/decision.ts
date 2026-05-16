/**
 * Heartbeat decision policy.
 *
 * Owns the current text-based heartbeat decision contract and retry cadence.
 * Future runtime checkpoint work should replace the decision-line parsing here
 * instead of duplicating heartbeat decision inference in scheduler or host code.
 */
import type { AgentHeartbeatResult, HeartbeatDecision } from './types.js';

export class HeartbeatDecisionPolicy {
  static infer(summary: string, outcome: string): HeartbeatDecision {
    const match = summary.match(/HEARTBEAT_DECISION:\s*(continue|pause|complete|escalate)\b/i);
    if (match) {
      return match[1].toLowerCase() as HeartbeatDecision;
    }

    if (outcome === 'done') {
      return 'pause';
    }

    return 'escalate';
  }

  static suggestNextDelayMs(decision: AgentHeartbeatResult['decision']): number | undefined {
    switch (decision) {
      case 'continue':
        return 60_000;
      case 'pause':
        return 15 * 60_000;
      case 'complete':
      case 'escalate':
        return undefined;
    }
  }
}
