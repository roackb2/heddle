import type { CryptoKey, JSONWebKeySet } from 'jose';
import type {
  ExecutionScope,
  HostedExecutionWorkflow,
} from '../contracts/index.js';

export type ExecutionAuthorityMcpConfig = {
  audience: string;
  serverId: string;
  ttlSeconds: number;
};

export type ExecutionAuthorityConfig = {
  issuer: string;
  adopterId: string;
  executionAudience: string;
  keyId: string;
  executionTtlSeconds: number;
  mcp?: ExecutionAuthorityMcpConfig;
};

export type ExecutionAuthorityIssueInput = {
  scope: Omit<ExecutionScope, 'adopterId'>;
  runtimeSessionId: string;
  invocationId: string;
  workflow: HostedExecutionWorkflow;
  mcp?: {
    allowedTools: readonly string[];
  };
};

export type IssuedMcpCapabilityMetadata = {
  capabilityId: string;
  serverId: string;
  allowedTools: readonly string[];
  expiresAt: string;
};

export type IssuedExecutionAuthorityMetadata = {
  scope: ExecutionScope;
  runtimeSessionId: string;
  invocationId: string;
  workflow: HostedExecutionWorkflow;
  issuedAt: string;
  executionExpiresAt: string;
  mcp?: IssuedMcpCapabilityMetadata;
};

/**
 * Short-lived credentials are available only through explicit accessors.
 * JSON serialization contains credential-free metadata. Identifiers can still
 * be product data and remain subject to the adopter's logging policy.
 */
export interface IssuedExecutionAuthority {
  readonly metadata: IssuedExecutionAuthorityMetadata;
  executionAssertion(): string;
  mcpCapability(): string | undefined;
  toJSON(): IssuedExecutionAuthorityMetadata;
}

export interface ExecutionAuthority {
  issue(input: ExecutionAuthorityIssueInput): Promise<IssuedExecutionAuthority>;
  publicJwks(): JSONWebKeySet;
}

export type ExecutionAuthorityKeyPair = {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
};

export type JoseExecutionAuthorityOptions = {
  now?: () => Date;
  createCapabilityId?: () => string;
};
