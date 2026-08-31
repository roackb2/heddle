/**
 * Zod schemas for heartbeat task persistence.
 *
 * These schemas own the on-disk JSON contract for heartbeat tasks and run
 * records. Checkpoints are still parsed with a minimal runtime shape because
 * the runtime loop does not yet expose a full checkpoint schema.
 */
import { z } from 'zod';
import { LlmUsageSchema } from '@/core/llm/usage/index.js';
import {
  MAX_HEARTBEAT_CANCELLATION_REASON_LENGTH,
  MAX_HEARTBEAT_RUN_REQUEST_REASON_LENGTH,
} from './types.js';

export const HeartbeatTaskStatusSchema = z.enum(['idle', 'running', 'waiting', 'blocked', 'complete', 'failed']);
export const HeartbeatDecisionSchema = z.enum(['continue', 'pause', 'complete', 'escalate']);
export const HeartbeatTaskContinuationModeSchema = z.enum(['operator', 'agent']);
export const HeartbeatTaskRecoveryReasonSchema = z.enum(['host-restart', 'operator']);
export const HeartbeatAdmissionDecisionSchema = z.enum(['ready', 'closed']);
export const HeartbeatAdmissionTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('namespace') }),
  z.object({
    kind: z.literal('group'),
    groupId: z.string().refine((value) => value.trim().length > 0, 'Admission group id cannot be blank.'),
  }),
]);

export const HeartbeatAdmissionStateSchema = z.object({
  version: z.literal(1),
  namespace: HeartbeatAdmissionDecisionSchema.optional(),
  groups: z.record(z.string(), HeartbeatAdmissionDecisionSchema),
});

const HeartbeatTaskExecutionSchema = z.object({
  executionId: z.string().describe('Fencing token for the currently owned execution attempt.'),
  ownerId: z.string().describe('Scheduler process or worker generation that owns this execution.'),
  claimedAt: z.string().describe('Timestamp when this execution claimed the task.'),
  runRequestGeneration: z.number().int().nonnegative().optional().describe('Run-request generation claimed by this execution.'),
});

const HeartbeatTaskRunRequestSchema = z.object({
  generation: z.number().int().nonnegative().describe('Latest accepted run-request generation.'),
  claimedGeneration: z.number().int().nonnegative().describe('Latest generation claimed by an execution.'),
  requestedAt: z.string().describe('Timestamp of the latest accepted run request.'),
  reason: z.string().min(1).max(MAX_HEARTBEAT_RUN_REQUEST_REASON_LENGTH).optional().describe('Bounded operator-facing reason for the latest request.'),
});

const HeartbeatTaskRecoverySchema = z.object({
  interruptedExecutionId: z.string().describe('Fencing token of the interrupted execution.'),
  interruptedOwnerId: z.string().describe('Scheduler owner whose execution was interrupted.'),
  recoveredAt: z.string().describe('Timestamp when the task became retryable again.'),
  reason: HeartbeatTaskRecoveryReasonSchema.describe('Host-owned reason for recovering the execution.'),
});

export const HeartbeatTaskExecutionOutcomeSchema = z.object({
  kind: z.enum(['agent', 'skipped', 'cancelled', 'retry', 'blocked', 'failed']).describe('How this outer heartbeat execution settled.'),
  executionId: z.string().describe('Outer heartbeat execution fencing identity.'),
  summary: z.string().describe('Operator-facing execution outcome summary.'),
  agentRunId: z.string().optional().describe('Nested agent run rejected by an explicit custom-handler outcome.'),
  reason: z.string().min(1).max(MAX_HEARTBEAT_CANCELLATION_REASON_LENGTH).optional()
    .describe('Bounded operator reason for targeted cancellation.'),
  finishedAt: z.string().describe('Timestamp when the outer heartbeat execution settled.'),
  runRequestGeneration: z.number().int().nonnegative().optional().describe('Run-request generation claimed by this execution.'),
});

export const HeartbeatTaskSchema = z.object({
  id: z.string().describe('Stable heartbeat task identifier.'),
  workspaceId: z.string().optional().describe('Workspace identifier this task belongs to.'),
  admissionGroupId: z.string()
    .refine((value) => value.trim().length > 0, 'Admission group id cannot be blank.')
    .optional()
    .describe('Opaque admission group checked in addition to namespace admission.'),
  task: z.string().describe('Durable task instruction the heartbeat should pursue.'),
  name: z.string().optional().describe('Human-facing task label.'),
  enabled: z.boolean().describe('Whether the scheduler may run this task.'),
  continuationMode: HeartbeatTaskContinuationModeSchema.default('operator').describe('Whether recurrence is controlled by the operator schedule or the agent decision.'),
  checkpointPath: z.string().optional().describe('Optional custom checkpoint file path.'),
  schedule: z.object({
    intervalMs: z.number().describe('Default interval between heartbeat runner cycles.'),
    nextRunAt: z.string().optional().describe('Timestamp when this task should next run.'),
  }).describe('Scheduler-owned cadence and run timing.'),
  runtime: z.object({
    model: z.string().optional().describe('Model override for this task.'),
    maxSteps: z.number().optional().describe('Maximum runtime steps for one runner cycle.'),
    workspaceRoot: z.string().optional().describe('Workspace root override for this task.'),
    stateDir: z.string().optional().describe('State directory override for this task.'),
    memoryDir: z.string().optional().describe('Memory directory override for this task.'),
    searchIgnoreDirs: z.array(z.string()).optional().describe('Search ignore directory overrides.'),
    systemContext: z.string().optional().describe('Additional system context for this task.'),
  }).optional().describe('Task-specific runtime overrides passed to the runner agent.'),
  state: z.object({
    status: HeartbeatTaskStatusSchema.describe('Current scheduler-facing task status.'),
    progress: z.string().optional().describe('Latest human-readable task progress.'),
    runId: z.string().optional().describe('Latest runtime run id.'),
    runAt: z.string().optional().describe('Timestamp when the latest run started or finished.'),
    loadedCheckpoint: z.boolean().optional().describe('Whether the latest run loaded a checkpoint.'),
    resumable: z.boolean().describe('Whether this task should be treated as resumable.'),
    result: z.lazy(() => AgentHeartbeatResultSchema).optional().describe('Latest heartbeat runner result.'),
    error: z.string().optional().describe('Latest scheduler or runner error.'),
    execution: HeartbeatTaskExecutionSchema.optional().describe('Currently owned execution attempt and fencing identity.'),
    runRequest: HeartbeatTaskRunRequestSchema.optional().describe('Durable level-triggered request state for a prompt task run.'),
    lastExecution: HeartbeatTaskExecutionOutcomeSchema.optional().describe('Latest outer heartbeat execution outcome.'),
    recovery: HeartbeatTaskRecoverySchema.optional().describe('Most recent explicit interrupted-execution recovery.'),
    updatedAt: z.string().optional().describe('Timestamp when this task record was last updated.'),
  }).optional().describe('Latest scheduler/result state for this heartbeat task.'),
});

export const AgentLoopCheckpointSchema = z.object({
  version: z.literal(1).describe('Runtime checkpoint format version.'),
  runId: z.string().describe('Runtime run id represented by this checkpoint.'),
  createdAt: z.string().describe('Timestamp when the checkpoint was created.'),
  state: z.object({
    runId: z.string(),
    status: z.string(),
    transcript: z.array(z.unknown()),
    trace: z.array(z.unknown()),
  }).passthrough().describe('Runtime loop state snapshot.'),
}).passthrough();

export const AgentHeartbeatResultSchema = z.object({
  decision: HeartbeatDecisionSchema,
  summary: z.string(),
  checkpoint: AgentLoopCheckpointSchema,
  state: z.object({
    runId: z.string(),
    finishedAt: z.string(),
    outcome: z.string(),
    usage: LlmUsageSchema.optional(),
  }).passthrough(),
}).passthrough();

const HeartbeatTaskAgentRunRecordSchema = z.object({
  task: HeartbeatTaskSchema.describe('Task state captured after this run.'),
  result: AgentHeartbeatResultSchema.describe('Heartbeat runner result.'),
  loadedCheckpoint: z.boolean().describe('Whether this run resumed from a stored checkpoint.'),
  outcome: HeartbeatTaskExecutionOutcomeSchema.extend({
    kind: z.literal('agent'),
  }).optional().describe('Outer execution correlation for agent records created by current Heddle versions.'),
});

const HeartbeatTaskNonAgentRunRecordSchema = z.object({
  task: HeartbeatTaskSchema.describe('Task state captured after this execution.'),
  outcome: HeartbeatTaskExecutionOutcomeSchema.extend({
    kind: z.enum(['skipped', 'cancelled', 'retry', 'blocked']),
  }).describe('Lightweight execution outcome with no fabricated agent state.'),
}).strict();

export const HeartbeatTaskRunRecordSchema = z.union([
  HeartbeatTaskAgentRunRecordSchema,
  HeartbeatTaskNonAgentRunRecordSchema,
]);
