/**
 * Zod schemas for heartbeat task persistence.
 *
 * These schemas own the on-disk JSON contract for heartbeat tasks and run
 * records. Checkpoints are still parsed with a minimal runtime shape because
 * the runtime loop does not yet expose a full checkpoint schema.
 */
import { z } from 'zod';

export const HeartbeatTaskStatusSchema = z.enum(['idle', 'running', 'waiting', 'blocked', 'complete', 'failed']);
export const HeartbeatDecisionSchema = z.enum(['continue', 'pause', 'complete', 'escalate']);

const LlmUsageSchema = z.object({
  inputTokens: z.number().describe('Prompt tokens reported for the heartbeat run.'),
  outputTokens: z.number().describe('Completion tokens reported for the heartbeat run.'),
  totalTokens: z.number().describe('Total tokens reported for the heartbeat run.'),
  cachedInputTokens: z.number().optional().describe('Provider-reported cached input tokens.'),
  reasoningTokens: z.number().optional().describe('Provider-reported reasoning tokens.'),
  requests: z.number().optional().describe('Number of provider requests represented by this usage aggregate.'),
}).passthrough();

export const HeartbeatTaskSchema = z.object({
  id: z.string().describe('Stable heartbeat task identifier.'),
  workspaceId: z.string().optional().describe('Workspace identifier this task belongs to.'),
  task: z.string().describe('Durable task instruction the heartbeat should pursue.'),
  name: z.string().optional().describe('Human-facing task label.'),
  enabled: z.boolean().describe('Whether the scheduler may run this task.'),
  checkpointPath: z.string().optional().describe('Optional custom checkpoint file path.'),
  schedule: z.object({
    intervalMs: z.number().describe('Default interval between heartbeat wake cycles.'),
    nextRunAt: z.string().optional().describe('Timestamp when this task should next wake.'),
  }).describe('Scheduler-owned cadence and wake timing.'),
  runtime: z.object({
    model: z.string().optional().describe('Model override for this task.'),
    maxSteps: z.number().optional().describe('Maximum runtime steps for one wake cycle.'),
    workspaceRoot: z.string().optional().describe('Workspace root override for this task.'),
    stateDir: z.string().optional().describe('State directory override for this task.'),
    memoryDir: z.string().optional().describe('Memory directory override for this task.'),
    searchIgnoreDirs: z.array(z.string()).optional().describe('Search ignore directory overrides.'),
    systemContext: z.string().optional().describe('Additional system context for this task.'),
  }).optional().describe('Task-specific runtime overrides passed to the wake service.'),
  state: z.object({
    status: HeartbeatTaskStatusSchema.describe('Current scheduler-facing task status.'),
    progress: z.string().optional().describe('Latest human-readable task progress.'),
    runId: z.string().optional().describe('Latest runtime run id.'),
    runAt: z.string().optional().describe('Timestamp when the latest run started or finished.'),
    loadedCheckpoint: z.boolean().optional().describe('Whether the latest run loaded a checkpoint.'),
    resumable: z.boolean().describe('Whether this task should be treated as resumable.'),
    result: z.lazy(() => AgentHeartbeatResultSchema).optional().describe('Latest heartbeat wake result.'),
    error: z.string().optional().describe('Latest scheduler or wake error.'),
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

const AgentHeartbeatResultSchema = z.object({
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

export const HeartbeatTaskRunRecordSchema = z.object({
  task: HeartbeatTaskSchema.describe('Task state captured after this run.'),
  result: AgentHeartbeatResultSchema.describe('Heartbeat wake result.'),
  loadedCheckpoint: z.boolean().describe('Whether this run resumed from a stored checkpoint.'),
});
