import type { TraceEvent } from '@/core/types.js';
import { HeddleEventType } from '@/core/event-types.js';

export const TRACE_EVENT_DOMAINS = {
  run: 'run',
  assistant: 'assistant',
  host: 'host',
  autonomy: 'autonomy',
  tool: 'tool',
  memory: 'memory',
  cyberloop: 'cyberloop',
} as const;

export const TRACE_EVENT_TYPES = {
  runStarted: HeddleEventType.runStarted,
  runFinished: HeddleEventType.runFinished,
  assistantTurn: HeddleEventType.assistantTurn,
  hostWarning: HeddleEventType.hostWarning,
  autonomyDecision: HeddleEventType.autonomyDecision,
  autonomyPostflight: HeddleEventType.autonomyPostflight,
  toolApprovalRequested: HeddleEventType.toolApprovalRequested,
  toolApprovalResolved: HeddleEventType.toolApprovalResolved,
  toolFallback: HeddleEventType.toolFallback,
  toolCalling: HeddleEventType.toolCalling,
  toolCompleted: HeddleEventType.toolCompleted,
  memoryCandidateRecorded: HeddleEventType.memoryCandidateRecorded,
  memoryCheckpointSkipped: HeddleEventType.memoryCheckpointSkipped,
  memoryMaintenanceStarted: HeddleEventType.memoryMaintenanceStarted,
  memoryMaintenanceFinished: HeddleEventType.memoryMaintenanceFinished,
  memoryMaintenanceFailed: HeddleEventType.memoryMaintenanceFailed,
  cyberloopAnnotation: HeddleEventType.cyberloopAnnotation,
} as const satisfies Record<string, TraceEvent['type']>;

export const TRACE_CORRELATION_FIELDS = {
  runId: 'runId',
  sessionId: 'sessionId',
  turnId: 'turnId',
  step: 'step',
  timestamp: 'timestamp',
} as const;
