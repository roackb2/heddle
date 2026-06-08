import type { ToolCall } from '@/core/types.js';
import type { ToolPolicyEnvelope, ToolPolicyOperation } from '@/core/tools/index.js';

export type AutopilotRootAccess = 'read' | 'write' | 'autopilot' | 'manual-only' | 'deny';

export type AutopilotProfilePreset = 'auto' | 'custom';

export type AutopilotRootSource =
  | 'generated-working-root'
  | 'user-trusted-repo'
  | 'custom-config'
  | 'safety-default';

export type AutopilotCapability =
  | 'read'
  | 'write'
  | 'execute'
  | 'simple-delete'
  | 'many-file-edit'
  | 'verification'
  | 'formatting'
  | 'dependency'
  | 'git-stage';

export type AutopilotRootPolicy = {
  path: string;
  access: AutopilotRootAccess;
  allow?: AutopilotCapability[];
  source?: AutopilotRootSource;
};

export type AutopilotProfile = {
  mode: 'interactive' | 'autopilot';
  preset?: AutopilotProfilePreset;
  roots: AutopilotRootPolicy[];
  environments: {
    allow: Array<'local' | 'dev'>;
    requireApproval: Array<'staging' | 'production' | 'unknown'>;
  };
};

export const AUTONOMY_PERMISSION_MODES = ['default', 'auto', 'custom'] as const;

export type AutonomyPermissionMode = typeof AUTONOMY_PERMISSION_MODES[number];

export type AutonomyPermissionModeConfig = {
  permissionMode?: AutonomyPermissionMode;
  autoTrustedRoots?: string[];
  autopilot?: AutopilotProfile;
};

export type AutopilotRootApproval = {
  label: string;
  root: string;
  relativeRoot: string;
  access: 'autopilot';
  allow: AutopilotCapability[];
};

export type AutonomyPermissionModeOption = {
  id: AutonomyPermissionMode;
  label: string;
  description: string;
  disabled?: boolean;
  disabledReason?: string;
};

export type NormalizedAutopilotRootPolicy = AutopilotRootPolicy & {
  path: string;
};

export type NormalizedAutopilotProfile = AutopilotProfile & {
  roots: NormalizedAutopilotRootPolicy[];
};

export type ToolPolicyRootDecision = {
  root: string;
  access: AutopilotRootAccess | 'unconfigured';
  matchedPolicyPath?: string;
};

export type ToolPolicyFacts = {
  tool: string;
  operations: ToolPolicyOperation[];
  command?: string;
  cwd?: string;
  claimedReadRoots: string[];
  claimedWriteRoots: string[];
  resolvedKnownTargets: string[];
  rootDecisions: ToolPolicyRootDecision[];
  hardDenyReasons: string[];
  approvalReasons: string[];
  claimMismatches: string[];
};

export type AutopilotDecision =
  | { type: 'allow'; reason: string; facts: ToolPolicyFacts }
  | { type: 'request'; reason: string; facts: ToolPolicyFacts }
  | { type: 'deny'; reason: string; facts: ToolPolicyFacts };

export type AutonomyPolicyHint = {
  kind: 'allow-root' | 'deny-root' | 'manual-only-root' | 'allow-capability' | 'hard-deny-pattern' | 'environment';
  message: string;
  candidateConfig?: unknown;
};

export type AutonomyEvaluation = {
  call: ToolCall;
  profileMode: AutopilotProfile['mode'];
  profilePreset?: AutopilotProfilePreset;
  envelope?: ToolPolicyEnvelope;
  facts: ToolPolicyFacts;
  decision: AutopilotDecision;
  policyHints: AutonomyPolicyHint[];
};

export type AutonomyPostflightAudit = {
  call: ToolCall;
  envelope?: ToolPolicyEnvelope;
  observedEffects: {
    changedPaths: string[];
    changedRoots: string[];
    exceededDeclaredRoots: string[];
    gitHistoryChanged: boolean;
  };
  decision: 'continue' | 'stop';
  reason?: string;
};
