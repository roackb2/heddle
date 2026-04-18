import { truncate } from '../../core/utils/text.js';

export function stripHeartbeatDecisionLine(summary: string): string {
  return summary.replace(/\n?\s*HEARTBEAT_DECISION:\s*(continue|pause|complete|escalate)\s*$/i, '');
}

export function firstLine(value: string): string {
  const line = value.trim().split('\n').find((candidate) => candidate.trim());
  return line ? truncate(line.trim(), 180) : '';
}
