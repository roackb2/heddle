import { jwtVerify } from 'jose';
import { z } from 'zod';
import {
  MCP_CAPABILITY_TYPE,
  McpCapabilityClaimsSchema,
} from '../contracts/index.js';
import {
  createJwtKeyResolver,
  resolveJwtVerificationUnavailableCategory,
} from '../internal/jwt-verification.js';
import {
  ExecutionHostMcpCapabilityUnavailableError,
  ExecutionHostMcpCapabilityVerificationError,
} from './errors.js';
import { JwtExecutionHostMcpCapabilityVerifierConfigSchema } from './schemas.js';
import type {
  ExecutionHostJwtVerifierOptions,
  ExecutionHostMcpCapabilityVerificationRequest,
  ExecutionHostMcpCapabilityVerifier,
  JwtExecutionHostMcpCapabilityVerifierConfig,
  VerifiedExecutionHostMcpCapability,
} from './types.js';

const AssertionSchema = z.string().trim().min(32).max(4_096);
type ParsedConfig = z.infer<
  typeof JwtExecutionHostMcpCapabilityVerifierConfigSchema
>;

/** Verifies MCP authority against an independently verified host invocation. */
export class JwtExecutionHostMcpCapabilityVerifier
implements ExecutionHostMcpCapabilityVerifier {
  readonly #config: Readonly<ParsedConfig>;
  readonly #keyResolver: NonNullable<ExecutionHostJwtVerifierOptions['keyResolver']>;
  readonly #now: () => Date;

  constructor(
    config: JwtExecutionHostMcpCapabilityVerifierConfig,
    options: ExecutionHostJwtVerifierOptions = {},
  ) {
    const parsed = JwtExecutionHostMcpCapabilityVerifierConfigSchema.parse(
      config,
    );
    this.#config = Object.freeze({
      ...parsed,
      jwksUrl: new URL(parsed.jwksUrl),
    });
    this.#keyResolver = options.keyResolver
      ?? createJwtKeyResolver(this.#config.jwksUrl);
    this.#now = options.now ?? (() => new Date());
  }

  async verify(
    rawRequest: ExecutionHostMcpCapabilityVerificationRequest,
  ): Promise<VerifiedExecutionHostMcpCapability> {
    try {
      const request = Object.freeze({
        ...rawRequest,
        assertion: AssertionSchema.parse(rawRequest.assertion),
      });
      const { payload } = await jwtVerify(
        request.assertion,
        this.#keyResolver,
        {
          algorithms: [...this.#config.jwtAlgorithms],
          audience: this.#config.audience,
          clockTolerance: this.#config.clockToleranceSeconds,
          currentDate: this.#now(),
          issuer: this.#config.issuer,
          maxTokenAge: this.#config.maxCapabilityAgeSeconds,
          requiredClaims: ['exp', 'iat', 'jti', 'sub'],
          typ: MCP_CAPABILITY_TYPE,
        },
      );
      const claims = McpCapabilityClaimsSchema.parse(payload);
      this.#assertInvocationBinding(claims, request);
      this.#assertBoundedLifetime(claims);

      return Object.freeze({
        assertion: request.assertion,
        capabilityId: claims.jti,
        serverId: claims.serverId,
        allowedTools: Object.freeze([...claims.allowedTools]),
        issuedAt: new Date(claims.iat * 1_000).toISOString(),
        expiresAt: new Date(claims.exp * 1_000).toISOString(),
      });
    } catch (error) {
      if (
        error instanceof ExecutionHostMcpCapabilityVerificationError
        || error instanceof ExecutionHostMcpCapabilityUnavailableError
      ) {
        throw error;
      }
      const category = resolveJwtVerificationUnavailableCategory(error);
      if (category) {
        throw new ExecutionHostMcpCapabilityUnavailableError(
          category,
          { cause: error },
        );
      }
      throw new ExecutionHostMcpCapabilityVerificationError({ cause: error });
    }
  }

  #assertInvocationBinding(
    claims: z.infer<typeof McpCapabilityClaimsSchema>,
    request: ExecutionHostMcpCapabilityVerificationRequest,
  ): void {
    const { identity } = request;
    if (
      claims.adopterId !== this.#config.trustedAdopterId
      || claims.adopterId !== identity.scope.adopterId
      || claims.tenantId !== identity.scope.tenantId
      || claims.sub !== identity.scope.subjectId
      || claims.productSessionId !== identity.scope.productSessionId
      || claims.runtimeSessionId !== identity.runtimeSessionId
      || claims.invocationId !== identity.invocationId
      || claims.workflow !== identity.workflow
      || claims.serverId !== this.#config.serverId
      || claims.jti === identity.invocationId
    ) {
      throw new ExecutionHostMcpCapabilityVerificationError();
    }
  }

  #assertBoundedLifetime(
    claims: z.infer<typeof McpCapabilityClaimsSchema>,
  ): void {
    const lifetimeSeconds = claims.exp - claims.iat;
    if (
      lifetimeSeconds <= 0
      || lifetimeSeconds > this.#config.maxCapabilityAgeSeconds
    ) {
      throw new ExecutionHostMcpCapabilityVerificationError();
    }
  }
}
