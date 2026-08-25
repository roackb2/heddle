import { z } from 'zod';
import {
  JwtAudienceSchema,
  JwtIssuerSchema,
  McpServerIdSchema,
  OpaqueIdSchema,
  isSafeWebUrl,
} from '../contracts/index.js';
import { EXECUTION_HOST_SUPPORTED_JWT_ALGORITHMS } from './types.js';

export const ExecutionHostJwtAlgorithmsSchema = z.array(
  z.enum(EXECUTION_HOST_SUPPORTED_JWT_ALGORITHMS),
).min(1).max(EXECUTION_HOST_SUPPORTED_JWT_ALGORITHMS.length).transform(
  (algorithms) => Object.freeze([...new Set(algorithms)]),
);

export const JwtExecutionIdentityVerifierConfigSchema = z.object({
  executionIssuer: JwtIssuerSchema,
  executionAudience: JwtAudienceSchema,
  executionJwksUrl: z.instanceof(URL).refine(
    isSafeWebUrl,
    'must use HTTPS or loopback HTTP and contain no credentials, query, or fragment',
  ),
  executionJwtAlgorithms: ExecutionHostJwtAlgorithmsSchema,
  trustedAdopterId: OpaqueIdSchema,
  maxAssertionAgeSeconds: z.number().int().min(1).max(15 * 60),
  assertionClockToleranceSeconds: z.number().int().min(0).max(60),
}).strict();

export const JwtExecutionHostMcpCapabilityVerifierConfigSchema = z.object({
  issuer: JwtIssuerSchema,
  audience: JwtAudienceSchema,
  jwksUrl: z.instanceof(URL).refine(
    isSafeWebUrl,
    'must use HTTPS or loopback HTTP and contain no credentials, query, or fragment',
  ),
  jwtAlgorithms: ExecutionHostJwtAlgorithmsSchema,
  trustedAdopterId: OpaqueIdSchema,
  serverId: McpServerIdSchema,
  maxCapabilityAgeSeconds: z.number().int().min(1).max(15 * 60),
  clockToleranceSeconds: z.number().int().min(0).max(60),
}).strict();
