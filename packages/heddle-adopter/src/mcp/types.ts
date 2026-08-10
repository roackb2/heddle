import type { JWTVerifyGetKey } from 'jose';
import type { HostedExecutionWorkflow } from '../contracts/index.js';

export type McpInvocationScope = {
  adopterId: string;
  tenantId: string;
  subjectId: string;
  productSessionId: string;
  runtimeSessionId: string;
  invocationId: string;
  workflow: HostedExecutionWorkflow;
};

export type VerifiedMcpCapability<TToolName extends string = string> = {
  capabilityId: string;
  serverId: string;
  allowedTools: readonly TToolName[];
  scope: McpInvocationScope;
  issuedAt: string;
  expiresAt: string;
};

export interface McpCapabilityVerifier<TToolName extends string = string> {
  verify(assertion: string): Promise<VerifiedMcpCapability<TToolName>>;
}

export type JwtMcpCapabilityVerifierConfig<TToolName extends string> = {
  issuer: string;
  audience: string;
  jwksUrl: URL;
  trustedAdopterId: string;
  serverId: string;
  supportedTools: readonly TToolName[];
  maxCapabilityAgeSeconds: number;
  clockToleranceSeconds?: number;
};

export type JwtMcpCapabilityVerifierOptions = {
  keyResolver?: JWTVerifyGetKey;
  now?: () => Date;
};
