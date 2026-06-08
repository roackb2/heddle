import { HeddleEventType } from '@/core/event-types.js';
import type { TraceEvent } from '@/core/types.js';
import type { AutonomyEvaluation, AutonomyPostflightAudit } from './types.js';

/**
 * Wraps autonomy domain objects in trace-owned event metadata.
 */
export class AutonomyTraceService {
  static decision(args: {
    evaluation: AutonomyEvaluation;
    step: number;
    timestamp: string;
  }): TraceEvent {
    return {
      type: HeddleEventType.autonomyDecision,
      evaluation: args.evaluation,
      step: args.step,
      timestamp: args.timestamp,
    };
  }

  static postflight(args: {
    audit: AutonomyPostflightAudit;
    step: number;
    timestamp: string;
  }): TraceEvent {
    return {
      type: HeddleEventType.autonomyPostflight,
      audit: args.audit,
      step: args.step,
      timestamp: args.timestamp,
    };
  }
}
