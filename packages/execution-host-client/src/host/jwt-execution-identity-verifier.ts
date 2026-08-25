import { jwtVerify } from 'jose';
import { z } from 'zod';
import {
  EXECUTION_ASSERTION_TYPE,
  ExecutionAssertionClaimsSchema,
} from '../contracts/index.js';
import {
  createJwtKeyResolver,
  resolveJwtVerificationUnavailableCategory,
} from '../internal/jwt-verification.js';
import {
  ExecutionIdentityUnavailableError,
  ExecutionIdentityVerificationError,
} from './errors.js';
import { JwtExecutionIdentityVerifierConfigSchema } from './schemas.js';
import type {
  ExecutionIdentityVerificationRequest,
  ExecutionIdentityVerifier,
  ExecutionHostJwtVerifierOptions,
  JwtExecutionIdentityVerifierConfig,
  VerifiedExecutionIdentity,
} from './types.js';

const AssertionSchema = z.string().trim().min(32).max(4_096);
type ParsedConfig = z.infer<typeof JwtExecutionIdentityVerifierConfigSchema>;

/** Verifies adopter authority and binds it to one exact host invocation. */
export class JwtExecutionIdentityVerifier implements ExecutionIdentityVerifier {
  readonly #config: Readonly<ParsedConfig>;
  readonly #keyResolver: NonNullable<ExecutionHostJwtVerifierOptions['keyResolver']>;
  readonly #now: () => Date;

  constructor(
    config: JwtExecutionIdentityVerifierConfig,
    options: ExecutionHostJwtVerifierOptions = {},
  ) {
    const parsed = JwtExecutionIdentityVerifierConfigSchema.parse(config);
    this.#config = Object.freeze({
      ...parsed,
      executionJwksUrl: new URL(parsed.executionJwksUrl),
    });
    this.#keyResolver = options.keyResolver
      ?? createJwtKeyResolver(this.#config.executionJwksUrl);
    this.#now = options.now ?? (() => new Date());
  }

  async verify(
    rawRequest: ExecutionIdentityVerificationRequest,
  ): Promise<VerifiedExecutionIdentity> {
    try {
      const request = Object.freeze({
        ...rawRequest,
        assertion: AssertionSchema.parse(rawRequest.assertion),
      });
      const { payload } = await jwtVerify(
        request.assertion,
        this.#keyResolver,
        {
          algorithms: [...this.#config.executionJwtAlgorithms],
          audience: this.#config.executionAudience,
          clockTolerance: this.#config.assertionClockToleranceSeconds,
          currentDate: this.#now(),
          issuer: this.#config.executionIssuer,
          maxTokenAge: this.#config.maxAssertionAgeSeconds,
          requiredClaims: ['exp', 'iat', 'jti', 'sub'],
          typ: EXECUTION_ASSERTION_TYPE,
        },
      );
      const claims = ExecutionAssertionClaimsSchema.parse(payload);
      this.#assertRequestBinding(claims, request);

      return Object.freeze({
        scope: Object.freeze({
          adopterId: claims.adopterId,
          tenantId: claims.tenantId,
          subjectId: claims.sub,
          productSessionId: claims.productSessionId,
        }),
        runtimeSessionId: claims.runtimeSessionId,
        invocationId: claims.jti,
        workflow: claims.workflow,
        issuedAt: new Date(claims.iat * 1_000).toISOString(),
        expiresAt: new Date(claims.exp * 1_000).toISOString(),
      });
    } catch (error) {
      if (
        error instanceof ExecutionIdentityVerificationError
        || error instanceof ExecutionIdentityUnavailableError
      ) {
        throw error;
      }
      const category = resolveJwtVerificationUnavailableCategory(error);
      if (category) {
        throw new ExecutionIdentityUnavailableError(category, { cause: error });
      }
      throw new ExecutionIdentityVerificationError({ cause: error });
    }
  }

  #assertRequestBinding(
    claims: z.infer<typeof ExecutionAssertionClaimsSchema>,
    request: ExecutionIdentityVerificationRequest,
  ): void {
    if (
      claims.adopterId !== this.#config.trustedAdopterId
      || claims.runtimeSessionId !== request.runtimeSessionId
      || claims.jti !== request.invocationId
      || claims.workflow !== request.workflow
    ) {
      throw new ExecutionIdentityVerificationError();
    }
  }
}
