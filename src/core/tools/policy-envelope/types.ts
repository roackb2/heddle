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

export type ToolPolicyHostAuthority =
  | {
      kind: 'mcp';
      serverId: string;
      toolName: string;
      tenantId?: string;
    }
  | {
      kind: 'host-tool';
      id: string;
      tenantId?: string;
    };

export type ToolPolicyHostTransport = {
  kind: 'in-process' | 'stdio' | 'http' | 'sse';
  network: boolean;
};

/**
 * Immutable execution facts supplied by the host that owns a tool.
 *
 * Model-authored policy envelopes may describe intent and expected effects,
 * but they cannot replace these facts during approval evaluation.
 */
export type ToolPolicyHostContext = {
  authority: ToolPolicyHostAuthority;
  transport: ToolPolicyHostTransport;
  environment: ToolPolicyEnvironment;
  operations?: readonly ToolPolicyOperation[];
};

export type ToolPolicyReconciliationDiagnostic = {
  code:
    | 'environment_overridden'
    | 'network_transport_normalized'
    | 'operations_overridden';
  message: string;
};

export type ToolPolicyFieldOwnership = {
  hostOwned: Array<'authority' | 'transport' | 'environment' | 'operations'>;
  modelProposed: Array<keyof ToolPolicyEnvelope>;
};

/**
 * Trace-safe policy reconciliation record. It intentionally excludes tool
 * business input so authorization traces do not duplicate potentially
 * sensitive arguments.
 */
export type ToolPolicyReconciliation = {
  modelProposed?: ToolPolicyEnvelope;
  hostOwned?: ToolPolicyHostContext;
  effective?: ToolPolicyEnvelope;
  ownership: ToolPolicyFieldOwnership;
  diagnostics: ToolPolicyReconciliationDiagnostic[];
};

export type ToolPolicyEnvelopeExtraction = {
  envelope?: ToolPolicyEnvelope;
  toolInput: unknown;
  error?: string;
};

export type ToolPolicyResolution = ToolPolicyEnvelopeExtraction & {
  reconciliation: ToolPolicyReconciliation;
};
