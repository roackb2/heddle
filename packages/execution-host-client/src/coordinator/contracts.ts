import { z } from 'zod';
import {
  ExecutionScopeSchema,
  HEARTBEAT_TASK_WORKFLOW,
  McpAllowedToolsSchema,
  McpServerIdSchema,
  OpaqueIdSchema,
  RuntimeSessionIdSchema,
  TimestampSchema,
} from '../contracts/index.js';

const ProductExecutionScopeSchema = ExecutionScopeSchema.omit({
  adopterId: true,
});

export const HOSTED_HEARTBEAT_COORDINATOR_PATHS = Object.freeze({
  state: '/v1/coordinator',
  tasks: '/v1/heartbeat/tasks',
  pause: '/v1/control/pause',
  resume: '/v1/control/resume',
  drain: '/v1/control/drain',
});

export const HOSTED_HEARTBEAT_DELEGATIONS_PATH =
  '/hosted-execution/internal/heartbeat-delegations';

export const HostedHeartbeatCoordinatorTaskInputSchema = z.object({
  workspaceId: OpaqueIdSchema.optional(),
  name: z.string().trim().min(1).max(200).optional(),
  task: z.string().trim().min(1).max(200_000),
  enabled: z.boolean().optional(),
  continuationMode: z.enum(['operator', 'agent']).optional(),
  intervalMs: z.number().int().min(1_000).max(Number.MAX_SAFE_INTEGER)
    .optional(),
  defer: z.boolean().optional(),
  model: z.string().trim().min(1).max(512).optional(),
  maxSteps: z.number().int().positive().max(10_000).optional(),
  searchIgnoreDirs: z.array(z.string().min(1).max(1_024)).max(1_000)
    .optional(),
  systemContext: z.string().max(200_000).optional(),
}).strict();

export const HostedHeartbeatCoordinatorStateSchema = z.enum([
  'running',
  'paused',
  'drained',
  'stopped',
]);

export const HostedHeartbeatCoordinatorStateResponseSchema = z.object({
  state: HostedHeartbeatCoordinatorStateSchema,
}).strict();

export const HostedHeartbeatCoordinatorTaskStatusSchema = z.enum([
  'idle',
  'running',
  'waiting',
  'blocked',
  'complete',
  'failed',
]);

export const HostedHeartbeatCoordinatorTaskResultSchema = z.object({
  kind: z.enum([
    'agent',
    'skipped',
    'cancelled',
    'retry',
    'blocked',
    'failed',
  ]),
  decision: z.enum(['continue', 'pause', 'complete', 'escalate']).optional(),
  summary: z.string(),
  outcome: z.string(),
  agentRunId: OpaqueIdSchema.optional(),
  usage: z.unknown().optional(),
}).passthrough();

/** Stable product/operator projection returned by the Coordinator API. */
export const HostedHeartbeatCoordinatorTaskViewSchema = z.object({
  id: OpaqueIdSchema,
  taskId: OpaqueIdSchema,
  workspaceId: OpaqueIdSchema.optional(),
  name: z.string().optional(),
  task: z.string(),
  enabled: z.boolean(),
  continuationMode: z.enum(['operator', 'agent']).optional(),
  schedule: z.object({
    intervalMs: z.number().int().positive(),
    nextRunAt: TimestampSchema.optional(),
  }).passthrough(),
  state: z.object({
    status: HostedHeartbeatCoordinatorTaskStatusSchema,
    progress: z.string().optional(),
    runId: OpaqueIdSchema.optional(),
    runAt: TimestampSchema.optional(),
    loadedCheckpoint: z.boolean().optional(),
    resumable: z.boolean().optional(),
    result: HostedHeartbeatCoordinatorTaskResultSchema.optional(),
    error: z.string().optional(),
    updatedAt: TimestampSchema.optional(),
  }).passthrough(),
}).passthrough();

export const HostedHeartbeatCoordinatorTaskListSchema = z.object({
  tasks: z.array(HostedHeartbeatCoordinatorTaskViewSchema),
}).strict();

export const HostedHeartbeatCoordinatorRunViewSchema = z.object({
  id: OpaqueIdSchema,
  taskId: OpaqueIdSchema,
  workspaceId: OpaqueIdSchema.optional(),
  executionId: OpaqueIdSchema,
  runId: OpaqueIdSchema.optional(),
  createdAt: TimestampSchema,
  task: HostedHeartbeatCoordinatorTaskViewSchema,
  result: HostedHeartbeatCoordinatorTaskResultSchema,
  loadedCheckpoint: z.boolean().optional(),
}).passthrough();

export const HostedHeartbeatCoordinatorTaskDetailSchema = z.object({
  task: HostedHeartbeatCoordinatorTaskViewSchema,
  runs: z.array(HostedHeartbeatCoordinatorRunViewSchema),
}).strict();

export const HostedHeartbeatDesiredTaskSchema = z.object({
  taskId: OpaqueIdSchema,
  input: HostedHeartbeatCoordinatorTaskInputSchema,
}).strict();

export const HostedHeartbeatDesiredTaskCatalogSchema = z.object({
  tasks: z.array(HostedHeartbeatDesiredTaskSchema).max(10_000),
  resume: z.boolean(),
}).strict().superRefine(({ tasks }, context) => {
  const seen = new Set<string>();
  tasks.forEach(({ taskId }, index) => {
    if (seen.has(taskId)) {
      context.addIssue({
        code: 'custom',
        path: ['tasks', index, 'taskId'],
        message: 'must be unique within the desired task catalog',
      });
    }
    seen.add(taskId);
  });
});

export const HostedHeartbeatDelegationRequestSchema = z.object({
  schemaVersion: z.literal(1),
  taskId: OpaqueIdSchema,
  executionId: OpaqueIdSchema,
}).strict();

const DelegatedAuthorityMetadataSchema = z.object({
  scope: ExecutionScopeSchema,
  runtimeSessionId: RuntimeSessionIdSchema,
  invocationId: OpaqueIdSchema,
  workflow: z.literal(HEARTBEAT_TASK_WORKFLOW),
  issuedAt: TimestampSchema,
  executionExpiresAt: TimestampSchema,
  mcp: z.object({
    capabilityId: OpaqueIdSchema,
    serverId: McpServerIdSchema,
    allowedTools: McpAllowedToolsSchema,
    expiresAt: TimestampSchema,
  }).strict(),
}).strict();

export const HostedHeartbeatDelegationSchema = z.object({
  schemaVersion: z.literal(1),
  taskId: OpaqueIdSchema,
  executionId: OpaqueIdSchema,
  scope: ProductExecutionScopeSchema,
  runtimeSessionId: RuntimeSessionIdSchema,
  deadlineAt: TimestampSchema,
  authority: z.object({
    metadata: DelegatedAuthorityMetadataSchema,
    executionAssertion: z.string().min(1).max(16_384),
    mcpCapability: z.string().min(1).max(16_384),
  }).strict(),
}).strict().superRefine((delegation, context) => {
  const metadata = delegation.authority.metadata;
  const mismatches: Array<[path: string, mismatched: boolean]> = [
    ['executionId', metadata.invocationId !== delegation.executionId],
    [
      'runtimeSessionId',
      metadata.runtimeSessionId !== delegation.runtimeSessionId,
    ],
    ['scope', !sameProductScope(metadata.scope, delegation.scope)],
  ];
  mismatches
    .filter(([, mismatched]) => mismatched)
    .forEach(([path]) => context.addIssue({
      code: 'custom',
      path: [path],
      message: 'must match the delegated execution authority metadata',
    }));
});

export const HostedHeartbeatDelegationAuthorizationSchema = z.object({
  scope: ProductExecutionScopeSchema,
  allowedTools: McpAllowedToolsSchema,
}).strict();

export type HostedHeartbeatCoordinatorTaskInput = z.infer<
  typeof HostedHeartbeatCoordinatorTaskInputSchema
>;
export type HostedHeartbeatCoordinatorState = z.infer<
  typeof HostedHeartbeatCoordinatorStateSchema
>;
export type HostedHeartbeatCoordinatorTaskView = z.infer<
  typeof HostedHeartbeatCoordinatorTaskViewSchema
>;
export type HostedHeartbeatCoordinatorRunView = z.infer<
  typeof HostedHeartbeatCoordinatorRunViewSchema
>;
export type HostedHeartbeatCoordinatorTaskDetail = z.infer<
  typeof HostedHeartbeatCoordinatorTaskDetailSchema
>;
export type HostedHeartbeatDesiredTask = z.infer<
  typeof HostedHeartbeatDesiredTaskSchema
>;
export type HostedHeartbeatDesiredTaskCatalog = z.infer<
  typeof HostedHeartbeatDesiredTaskCatalogSchema
>;
export type HostedHeartbeatDelegationRequest = z.infer<
  typeof HostedHeartbeatDelegationRequestSchema
>;
export type HostedHeartbeatDelegation = z.infer<
  typeof HostedHeartbeatDelegationSchema
>;
export type HostedHeartbeatDelegationAuthorization = z.infer<
  typeof HostedHeartbeatDelegationAuthorizationSchema
>;

function sameProductScope(
  left: z.infer<typeof ExecutionScopeSchema>,
  right: z.infer<typeof ProductExecutionScopeSchema>,
): boolean {
  return left.tenantId === right.tenantId
    && left.subjectId === right.subjectId
    && left.productSessionId === right.productSessionId;
}
