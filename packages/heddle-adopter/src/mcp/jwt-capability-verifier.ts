import {
  createRemoteJWKSet,
  errors,
  jwtVerify,
} from 'jose';
import { z } from 'zod';
import {
  JwtAudienceSchema,
  JwtIssuerSchema,
  MCP_CAPABILITY_TYPE,
  McpAllowedToolsSchema,
  McpCapabilityClaimsSchema,
  McpServerIdSchema,
  OpaqueIdSchema,
  isSafeWebUrl,
} from '../contracts/index.js';
import {
  McpCapabilityUnavailableError,
  McpCapabilityVerificationError,
} from './errors.js';
import type {
  JwtMcpCapabilityVerifierConfig,
  JwtMcpCapabilityVerifierOptions,
  McpCapabilityVerifier,
  VerifiedMcpCapability,
} from './types.js';

const CapabilityAssertionSchema = z.string().min(32).max(4_096);
const ConfigSchema = z.object({
  issuer: JwtIssuerSchema,
  audience: JwtAudienceSchema,
  jwksUrl: z.instanceof(URL).refine(
    isSafeWebUrl,
    'must use HTTPS or loopback HTTP and contain no credentials, query, or fragment',
  ),
  trustedAdopterId: OpaqueIdSchema,
  serverId: McpServerIdSchema,
  supportedTools: McpAllowedToolsSchema,
  maxCapabilityAgeSeconds: z.number().int().min(1).max(15 * 60),
  clockToleranceSeconds: z.number().int().min(0).max(60).default(5),
}).strict();

type ParsedConfig = Omit<z.infer<typeof ConfigSchema>, 'supportedTools'> & {
  supportedTools: readonly string[];
};

/**
 * Independently verifies an adopter-signed capability at the adopter's MCP
 * edge. Execution Host verification is defense in depth, not forwarded trust.
 */
export class JwtMcpCapabilityVerifier<TToolName extends string>
implements McpCapabilityVerifier<TToolName> {
  readonly #config: Readonly<ParsedConfig>;
  readonly #supportedTools: ReadonlySet<string>;
  readonly #keyResolver: NonNullable<JwtMcpCapabilityVerifierOptions['keyResolver']>;
  readonly #now: () => Date;

  constructor(
    config: JwtMcpCapabilityVerifierConfig<TToolName>,
    options: JwtMcpCapabilityVerifierOptions = {},
  ) {
    const parsed = ConfigSchema.parse(config);
    this.#config = Object.freeze({
      ...parsed,
      jwksUrl: new URL(parsed.jwksUrl),
      supportedTools: Object.freeze([...parsed.supportedTools]),
    });
    this.#supportedTools = new Set(this.#config.supportedTools);
    this.#keyResolver = options.keyResolver ?? createRemoteJWKSet(
      this.#config.jwksUrl,
      {
        cacheMaxAge: 10 * 60_000,
        cooldownDuration: 30_000,
        timeoutDuration: 3_000,
      },
    );
    this.#now = options.now ?? (() => new Date());
  }

  async verify(assertion: string): Promise<VerifiedMcpCapability<TToolName>> {
    try {
      const compactJwt = CapabilityAssertionSchema.parse(assertion);
      const { payload } = await jwtVerify(compactJwt, this.#keyResolver, {
        algorithms: ['ES256'],
        audience: this.#config.audience,
        clockTolerance: this.#config.clockToleranceSeconds,
        currentDate: this.#now(),
        issuer: this.#config.issuer,
        maxTokenAge: this.#config.maxCapabilityAgeSeconds,
        requiredClaims: ['exp', 'iat', 'jti', 'sub'],
        typ: MCP_CAPABILITY_TYPE,
      });
      const claims = McpCapabilityClaimsSchema.parse(payload);
      this.#assertDeploymentBinding(claims);
      this.#assertBoundedLifetime(claims);
      this.#assertSupportedTools(claims.allowedTools);

      return freezeVerifiedCapability({
        capabilityId: claims.jti,
        serverId: claims.serverId,
        allowedTools: claims.allowedTools as TToolName[],
        scope: {
          adopterId: claims.adopterId,
          tenantId: claims.tenantId,
          subjectId: claims.sub,
          productSessionId: claims.productSessionId,
          runtimeSessionId: claims.runtimeSessionId,
          invocationId: claims.invocationId,
          workflow: claims.workflow,
        },
        issuedAt: new Date(claims.iat * 1_000).toISOString(),
        expiresAt: new Date(claims.exp * 1_000).toISOString(),
      });
    } catch (error) {
      if (
        error instanceof McpCapabilityVerificationError
        || error instanceof McpCapabilityUnavailableError
      ) {
        throw error;
      }
      const unavailableCategory = resolveUnavailableCategory(error);
      if (unavailableCategory) {
        throw new McpCapabilityUnavailableError(unavailableCategory);
      }
      throw new McpCapabilityVerificationError();
    }
  }

  #assertDeploymentBinding(
    claims: z.infer<typeof McpCapabilityClaimsSchema>,
  ): void {
    if (
      claims.adopterId !== this.#config.trustedAdopterId
      || claims.serverId !== this.#config.serverId
      || claims.jti === claims.invocationId
    ) {
      throw new McpCapabilityVerificationError();
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
      throw new McpCapabilityVerificationError();
    }
  }

  #assertSupportedTools(tools: readonly string[]): void {
    if (!tools.every((tool) => this.#supportedTools.has(tool))) {
      throw new McpCapabilityVerificationError();
    }
  }
}

export function assertMcpCapabilityActive(
  capability: VerifiedMcpCapability,
  now = new Date(),
): void {
  const expiresAt = Date.parse(capability.expiresAt);
  if (!Number.isFinite(expiresAt) || now.getTime() >= expiresAt) {
    throw new McpCapabilityVerificationError();
  }
}

function freezeVerifiedCapability<TToolName extends string>(
  capability: VerifiedMcpCapability<TToolName>,
): VerifiedMcpCapability<TToolName> {
  return Object.freeze({
    ...capability,
    allowedTools: Object.freeze([...capability.allowedTools]),
    scope: Object.freeze({ ...capability.scope }),
  });
}

const UNAVAILABLE_JOSE_CODES = new Set([
  'ERR_JOSE_GENERIC',
  'ERR_JWK_INVALID',
  'ERR_JWKS_INVALID',
  'ERR_JWKS_MULTIPLE_MATCHING_KEYS',
  'ERR_JWKS_TIMEOUT',
]);

function resolveUnavailableCategory(
  error: unknown,
): 'network' | 'jwks' | undefined {
  if (error instanceof TypeError) {
    return 'network';
  }
  if (
    error instanceof errors.JOSEError
    && UNAVAILABLE_JOSE_CODES.has(error.code)
  ) {
    return 'jwks';
  }
  return undefined;
}
