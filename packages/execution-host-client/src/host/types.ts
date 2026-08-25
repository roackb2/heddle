import type { JWTVerifyGetKey } from 'jose';
import type {
  ExecutionScope,
  HostedExecutionWorkflow,
} from '../contracts/index.js';

export const EXECUTION_HOST_SUPPORTED_JWT_ALGORITHMS = [
  'RS256',
  'PS256',
  'ES256',
  'EdDSA',
] as const;

export type ExecutionHostJwtAlgorithm =
  typeof EXECUTION_HOST_SUPPORTED_JWT_ALGORITHMS[number];

/** Authority established from one signed assertion and its request binding. */
export type VerifiedExecutionIdentity = Readonly<{
  scope: Readonly<ExecutionScope>;
  runtimeSessionId: string;
  invocationId: string;
  workflow: HostedExecutionWorkflow;
  issuedAt: string;
  expiresAt: string;
}>;

export type ExecutionIdentityVerificationRequest = Readonly<{
  assertion: string;
  runtimeSessionId: string;
  invocationId: string;
  workflow: HostedExecutionWorkflow;
}>;

export interface ExecutionIdentityVerifier {
  verify(
    request: ExecutionIdentityVerificationRequest,
  ): Promise<VerifiedExecutionIdentity>;
}

export type JwtExecutionIdentityVerifierConfig = Readonly<{
  executionIssuer: string;
  executionAudience: string;
  executionJwksUrl: URL;
  executionJwtAlgorithms: readonly ExecutionHostJwtAlgorithm[];
  trustedAdopterId: string;
  maxAssertionAgeSeconds: number;
  assertionClockToleranceSeconds: number;
}>;

/** Opaque MCP bearer whose claims match the independently verified execution. */
export type VerifiedExecutionHostMcpCapability = Readonly<{
  assertion: string;
  capabilityId: string;
  serverId: string;
  allowedTools: readonly string[];
  issuedAt: string;
  expiresAt: string;
}>;

export type ExecutionHostMcpCapabilityVerificationRequest = Readonly<{
  assertion: string;
  identity: VerifiedExecutionIdentity;
}>;

export interface ExecutionHostMcpCapabilityVerifier {
  verify(
    request: ExecutionHostMcpCapabilityVerificationRequest,
  ): Promise<VerifiedExecutionHostMcpCapability>;
}

export type JwtExecutionHostMcpCapabilityVerifierConfig = Readonly<{
  issuer: string;
  audience: string;
  jwksUrl: URL;
  jwtAlgorithms: readonly ExecutionHostJwtAlgorithm[];
  trustedAdopterId: string;
  serverId: string;
  maxCapabilityAgeSeconds: number;
  clockToleranceSeconds: number;
}>;

export type ExecutionHostJwtVerifierOptions = Readonly<{
  keyResolver?: JWTVerifyGetKey;
  now?: () => Date;
}>;
