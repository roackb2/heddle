import type { TraceEvent } from '../types.js';

export const TRACE_EVENT_DOMAINS = {
  run: 'run',
  assistant: 'assistant',
  host: 'host',
  tool: 'tool',
  memory: 'memory',
  cyberloop: 'cyberloop',
} as const;

export const TRACE_EVENT_TYPES = {
  runStarted: 'run.started',
  runFinished: 'run.finished',
  assistantTurn: 'assistant.turn',
  hostWarning: 'host.warning',
  toolApprovalRequested: 'tool.approval_requested',
  toolApprovalResolved: 'tool.approval_resolved',
  toolFallback: 'tool.fallback',
  toolCall: 'tool.call',
  toolResult: 'tool.result',
  memoryCandidateRecorded: 'memory.candidate_recorded',
  memoryCheckpointSkipped: 'memory.checkpoint_skipped',
  memoryMaintenanceStarted: 'memory.maintenance_started',
  memoryMaintenanceFinished: 'memory.maintenance_finished',
  memoryMaintenanceFailed: 'memory.maintenance_failed',
  cyberloopAnnotation: 'cyberloop.annotation',
} as const satisfies Record<string, TraceEvent['type']>;

export const TRACE_CORRELATION_FIELDS = {
  runId: 'runId',
  sessionId: 'sessionId',
  turnId: 'turnId',
  step: 'step',
  timestamp: 'timestamp',
} as const;
