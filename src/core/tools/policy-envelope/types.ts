export type ToolPolicyOperation =
  | 'read'
  | 'write'
  | 'delete'
  | 'move'
  | 'execute'
  | 'git'
  | 'network'
  | 'unknown';

export type ToolPolicyEnvironment =
  | 'local'
  | 'dev'
  | 'staging'
  | 'production'
  | 'unknown';

export type ToolPolicyConfidence = 'high' | 'medium' | 'low';

export type ToolPolicyEnvelope = {
  operations: ToolPolicyOperation[];
  intent: string;
  targetRoots: string[];
  readRoots?: string[];
  writeRoots?: string[];
  expectedEffects: string[];
  maxDestructiveScope?: 'none' | 'single-file' | 'generated-files' | 'many-files';
  environment: ToolPolicyEnvironment;
  confidence: ToolPolicyConfidence;
};

export type ToolPolicyEnvelopeExtraction = {
  envelope?: ToolPolicyEnvelope;
  toolInput: unknown;
  error?: string;
};
