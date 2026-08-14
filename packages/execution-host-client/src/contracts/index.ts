import { z } from 'zod';

export const EXECUTION_CONTRACT_VERSION = 1 as const;
export const CONVERSATION_TURN_WORKFLOW = 'conversation-turn' as const;
export const EXECUTION_ASSERTION_TYPE = 'heddle-execution+jwt' as const;
export const MCP_CAPABILITY_TYPE = 'heddle-mcp-capability+jwt' as const;

export const AGENTCORE_RUNTIME_SESSION_HEADER =
  'x-amzn-bedrock-agentcore-runtime-session-id' as const;
export const EXECUTION_HOST_LOCAL_TOKEN_HEADER =
  'x-heddle-execution-host-local-token' as const;
export const EXECUTION_ASSERTION_HEADER =
  'x-heddle-execution-host-assertion' as const;
export const MCP_CAPABILITY_HEADER =
  'x-heddle-execution-host-mcp-capability' as const;
export const MODEL_API_KEY_HEADER =
  'x-heddle-execution-host-model-api-key' as const;

export const OpaqueIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._:@-]*$/,
    'must be an opaque, path-free identifier',
  );

export const JwtIssuerSchema = z.url().refine(
  (value) => isSafeWebUrl(new URL(value)),
  'must use HTTPS or loopback HTTP and contain no credentials, query, or fragment',
);

export const JwtAudienceSchema = z.string().min(1).max(512);

export const RuntimeSessionIdSchema = z
  .string()
  .min(33)
  .max(256)
  .refine((value) => value === value.trim(), 'must not contain outer whitespace');

export const TimestampSchema = z.iso.datetime({ offset: true });

export const McpServerIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(
    /^[A-Za-z0-9_-]+$/,
    'must be a Heddle-compatible MCP server identifier',
  );

export const McpToolNameSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(
    /^[A-Za-z][A-Za-z0-9_]*$/,
    'must be a collision-free MCP tool name',
  );

export const McpAllowedToolsSchema = z
  .array(McpToolNameSchema)
  .min(1)
  .max(16)
  .refine((tools) => new Set(tools).size === tools.length, {
    message: 'must contain unique MCP tool names',
  })
  .refine(
    (tools) => tools.reduce(
      (characterCount, toolName) => characterCount + toolName.length,
      0,
    ) <= 512,
    { message: 'contains too many aggregate tool-name characters' },
  );

export const ExecutionScopeSchema = z.object({
  adopterId: OpaqueIdSchema,
  tenantId: OpaqueIdSchema,
  subjectId: OpaqueIdSchema,
  productSessionId: OpaqueIdSchema,
}).strict();

export const ExecutionHostConversationTurnRequestSchema = z.object({
  schemaVersion: z.literal(EXECUTION_CONTRACT_VERSION),
  kind: z.literal(CONVERSATION_TURN_WORKFLOW),
  invocationId: OpaqueIdSchema,
  prompt: z.string().trim().min(1).max(200_000),
  deadlineAt: TimestampSchema.optional(),
}).strict();

export const RuntimePublicResultSchema = z.object({
  outcome: z.enum(['done', 'max_steps', 'error', 'interrupted']),
  summary: z.string().optional(),
  failure: z.object({
    source: z.literal('model'),
    code: z.enum([
      'authentication',
      'permission',
      'quota',
      'rate_limit',
      'context_window',
      'request',
      'transport',
      'empty_response',
      'unknown',
    ]),
  }).strict().optional(),
}).strict();

const StreamEnvelopeSchema = z.object({
  schemaVersion: z.literal(EXECUTION_CONTRACT_VERSION),
  invocationId: OpaqueIdSchema,
  runId: OpaqueIdSchema,
  sequence: z.number().int().nonnegative(),
  timestamp: TimestampSchema,
});

export const ExecutionHostStreamEventSchema = z.discriminatedUnion('kind', [
  StreamEnvelopeSchema.extend({
    sequence: z.literal(0),
    kind: z.literal('accepted'),
  }).strict(),
  StreamEnvelopeSchema.extend({
    kind: z.literal('activity'),
    activity: z.unknown(),
  }).strict(),
  StreamEnvelopeSchema.extend({
    kind: z.literal('result'),
    result: RuntimePublicResultSchema,
  }).strict(),
  StreamEnvelopeSchema.extend({
    kind: z.literal('cancelled'),
    reason: z.string(),
  }).strict(),
  StreamEnvelopeSchema.extend({
    kind: z.literal('error'),
    error: z.object({
      code: z.string().min(1).max(128).regex(/^[a-z0-9_]+$/),
      message: z.string().min(1).max(1_600),
    }).strict(),
  }).strict(),
]);

export const ExecutionAssertionClaimsSchema = z.object({
  iss: JwtIssuerSchema,
  aud: JwtAudienceSchema,
  contractVersion: z.literal(EXECUTION_CONTRACT_VERSION),
  adopterId: OpaqueIdSchema,
  tenantId: OpaqueIdSchema,
  productSessionId: OpaqueIdSchema,
  runtimeSessionId: RuntimeSessionIdSchema,
  workflow: z.literal(CONVERSATION_TURN_WORKFLOW),
  sub: OpaqueIdSchema,
  jti: OpaqueIdSchema,
  iat: z.number().int().nonnegative(),
  exp: z.number().int().positive(),
}).passthrough();

export const McpCapabilityClaimsSchema = z.object({
  iss: JwtIssuerSchema,
  aud: JwtAudienceSchema,
  contractVersion: z.literal(EXECUTION_CONTRACT_VERSION),
  adopterId: OpaqueIdSchema,
  tenantId: OpaqueIdSchema,
  productSessionId: OpaqueIdSchema,
  runtimeSessionId: RuntimeSessionIdSchema,
  invocationId: OpaqueIdSchema,
  workflow: z.literal(CONVERSATION_TURN_WORKFLOW),
  serverId: McpServerIdSchema,
  allowedTools: McpAllowedToolsSchema,
  sub: OpaqueIdSchema,
  jti: OpaqueIdSchema,
  iat: z.number().int().nonnegative(),
  exp: z.number().int().positive(),
}).passthrough();

export type ExecutionScope = z.infer<typeof ExecutionScopeSchema>;
export type ExecutionHostConversationTurnRequest = z.infer<
  typeof ExecutionHostConversationTurnRequestSchema
>;
export type RuntimePublicResult = z.infer<typeof RuntimePublicResultSchema>;
export type ExecutionHostStreamEvent = z.infer<
  typeof ExecutionHostStreamEventSchema
>;
export type ExecutionHostTerminalEvent = Extract<
  ExecutionHostStreamEvent,
  { kind: 'result' | 'cancelled' | 'error' }
>;
export type ExecutionAssertionClaims = z.infer<
  typeof ExecutionAssertionClaimsSchema
>;
export type McpCapabilityClaims = z.infer<typeof McpCapabilityClaimsSchema>;
export type HostedExecutionWorkflow = typeof CONVERSATION_TURN_WORKFLOW;

export function isExecutionHostTerminalEvent(
  event: ExecutionHostStreamEvent,
): event is ExecutionHostTerminalEvent {
  return event.kind === 'result'
    || event.kind === 'cancelled'
    || event.kind === 'error';
}

export function isSafeWebUrl(url: URL): boolean {
  const loopback = ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname);
  return (url.protocol === 'https:' || (url.protocol === 'http:' && loopback))
    && !url.username
    && !url.password
    && !url.search
    && !url.hash;
}
