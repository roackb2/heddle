/**
 * Central event vocabulary for trace records and live conversation activity.
 *
 * Keep shared moments on the same string value across trace and activity so
 * contributors cannot accidentally create parallel names for the same event.
 */
export const HeddleEventType = {
  runStarted: 'run.started',
  assistantTurn: 'assistant.turn',
  assistantStream: 'assistant.stream',
  reasoningSummary: 'reasoning.summary',
  modelRetry: 'model.retry',
  hostWarning: 'host.warning',
  autonomyDecision: 'autonomy.decision',
  autonomyPostflight: 'autonomy.postflight',
  toolApprovalRequested: 'tool.approval_requested',
  toolApprovalResolved: 'tool.approval_resolved',
  toolFallback: 'tool.fallback',
  toolCalling: 'tool.calling',
  toolCompleted: 'tool.completed',
  planUpdated: 'plan.updated',
  memoryCandidateRecorded: 'memory.candidate_recorded',
  memoryCheckpointSkipped: 'memory.checkpoint_skipped',
  memoryMaintenanceStarted: 'memory.maintenance_started',
  memoryMaintenanceFinished: 'memory.maintenance_finished',
  memoryMaintenanceFailed: 'memory.maintenance_failed',
  cyberloopAnnotation: 'cyberloop.annotation',
  runFinished: 'run.finished',
  loopStarted: 'loop.started',
  loopResumed: 'loop.resumed',
  loopFinished: 'loop.finished',
  checkpointSaved: 'checkpoint.saved',
  trace: 'trace',
  compactionRunning: 'compaction.running',
  compactionFinished: 'compaction.finished',
  compactionFailed: 'compaction.failed',
  directShellStarted: 'direct_shell.started',
  directShellCompleted: 'direct_shell.completed',
} as const;

export type HeddleEventTypeValue = typeof HeddleEventType[keyof typeof HeddleEventType];
