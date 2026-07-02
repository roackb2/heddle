export const TOOL_POLICY_OPERATIONS = ['read', 'write', 'delete', 'move', 'execute', 'git', 'network', 'unknown'] as const;
export const TOOL_POLICY_DESTRUCTIVE_SCOPES = ['none', 'single-file', 'generated-files', 'many-files'] as const;
export const TOOL_POLICY_ENVIRONMENTS = ['local', 'dev', 'staging', 'production', 'unknown'] as const;
export const TOOL_POLICY_CONFIDENCE_LEVELS = ['high', 'medium', 'low'] as const;

export type ToolPolicyOperation = (typeof TOOL_POLICY_OPERATIONS)[number];

/**
 * Operation categories that can mutate state and therefore claim write roots.
 * Shared source of truth for envelope validation (a mutating envelope must
 * declare at least one root) and autonomy write-root derivation.
 */
export const TOOL_POLICY_MUTATING_OPERATIONS: ReadonlySet<ToolPolicyOperation> = new Set([
  'write',
  'delete',
  'move',
  'execute',
  'git',
  'network',
  'unknown',
]);

export type ToolPolicyDestructiveScope = (typeof TOOL_POLICY_DESTRUCTIVE_SCOPES)[number];
export type ToolPolicyEnvironment = (typeof TOOL_POLICY_ENVIRONMENTS)[number];
export type ToolPolicyConfidence = (typeof TOOL_POLICY_CONFIDENCE_LEVELS)[number];

export type ToolPolicyEnvelope = {
  operations: ToolPolicyOperation[];
  intent: string;
  targetRoots: string[];
  readRoots?: string[];
  writeRoots?: string[];
  expectedEffects: string[];
  maxDestructiveScope?: ToolPolicyDestructiveScope;
  environment: ToolPolicyEnvironment;
  confidence: ToolPolicyConfidence;
};

export type ToolPolicyEnvelopeExtraction = {
  envelope?: ToolPolicyEnvelope;
  toolInput: unknown;
  error?: string;
};
