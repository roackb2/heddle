import { randomUUID } from 'node:crypto';
import {
  CompactSign,
  SignJWT,
  compactVerify,
  exportJWK,
  type CryptoKey,
  type JWK,
  type JSONWebKeySet,
} from 'jose';
import { z } from 'zod';
import {
  EXECUTION_ASSERTION_TYPE,
  EXECUTION_CONTRACT_VERSION,
  ExecutionScopeSchema,
  HostedExecutionWorkflowSchema,
  JwtAudienceSchema,
  JwtIssuerSchema,
  MCP_CAPABILITY_TYPE,
  McpAllowedToolsSchema,
  McpServerIdSchema,
  OpaqueIdSchema,
  RuntimeSessionIdSchema,
  type ExecutionScope,
} from '../contracts/index.js';
import type {
  ExecutionAuthority,
  ExecutionAuthorityConfig,
  ExecutionAuthorityIssueInput,
  ExecutionAuthorityKeyPair,
  IssuedExecutionAuthority,
  IssuedExecutionAuthorityMetadata,
  JoseExecutionAuthorityOptions,
} from './types.js';

const SIGNING_ALGORITHM = 'ES256';
const ExecutionAuthorityMcpConfigSchema = z.object({
  audience: JwtAudienceSchema,
  serverId: McpServerIdSchema,
  ttlSeconds: z.number().int().min(1).max(15 * 60),
}).strict();
const ExecutionAuthorityConfigSchema = z.object({
  issuer: JwtIssuerSchema,
  adopterId: OpaqueIdSchema,
  executionAudience: JwtAudienceSchema,
  keyId: OpaqueIdSchema,
  executionTtlSeconds: z.number().int().min(1).max(15 * 60),
  mcp: ExecutionAuthorityMcpConfigSchema.optional(),
}).strict().superRefine((config, context) => {
  if (!config.mcp) {
    return;
  }
  if (config.executionAudience === config.mcp.audience) {
    context.addIssue({
      code: 'custom',
      path: ['mcp', 'audience'],
      message: 'must be distinct from the execution audience',
    });
  }
  if (config.mcp.ttlSeconds < config.executionTtlSeconds) {
    context.addIssue({
      code: 'custom',
      path: ['mcp', 'ttlSeconds'],
      message: 'must not expire before execution admission authority',
    });
  }
});
const ExecutionIssueScopeSchema = ExecutionScopeSchema.omit({ adopterId: true });
const ExecutionAuthorityIssueInputSchema = z.object({
  scope: ExecutionIssueScopeSchema,
  runtimeSessionId: RuntimeSessionIdSchema,
  invocationId: OpaqueIdSchema,
  workflow: HostedExecutionWorkflowSchema,
  mcp: z.object({
    allowedTools: McpAllowedToolsSchema,
  }).strict().optional(),
}).strict();
const PublicP256JwkSchema = z.object({
  kty: z.literal('EC'),
  crv: z.literal('P-256'),
  x: z.string().regex(/^[A-Za-z0-9_-]+$/),
  y: z.string().regex(/^[A-Za-z0-9_-]+$/),
}).passthrough().superRefine((jwk, context) => {
  const privateFields = ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth', 'k'];
  if (privateFields.some((field) => field in jwk)) {
    context.addIssue({
      code: 'custom',
      message: 'must not contain private key material',
    });
  }
});

/**
 * ES256 reference adapter for issuing one invocation's admission assertion and
 * optional product-MCP capability.
 */
export class JoseExecutionAuthority implements ExecutionAuthority {
  readonly #config: z.infer<typeof ExecutionAuthorityConfigSchema>;
  readonly #privateKey: CryptoKey;
  readonly #publicJwk: Readonly<JWK>;
  readonly #now: () => Date;
  readonly #createCapabilityId: () => string;

  private constructor(
    config: ExecutionAuthorityConfig,
    key: { privateKey: CryptoKey; publicJwk: JWK },
    options: JoseExecutionAuthorityOptions,
  ) {
    this.#config = deepFreezeConfig(ExecutionAuthorityConfigSchema.parse(config));
    assertPrivateSigningKey(key.privateKey);
    this.#privateKey = key.privateKey;
    this.#publicJwk = projectPublicJwk(key.publicJwk, this.#config.keyId);
    this.#now = options.now ?? (() => new Date());
    this.#createCapabilityId = options.createCapabilityId ?? randomUUID;
  }

  static async create(
    config: ExecutionAuthorityConfig,
    keyPair: ExecutionAuthorityKeyPair,
    options: JoseExecutionAuthorityOptions = {},
  ): Promise<JoseExecutionAuthority> {
    assertPrivateSigningKey(keyPair.privateKey);
    assertPublicVerificationKey(keyPair.publicKey);
    await assertMatchingKeyPair(keyPair);
    return new JoseExecutionAuthority(
      config,
      {
        privateKey: keyPair.privateKey,
        publicJwk: await exportJWK(keyPair.publicKey),
      },
      options,
    );
  }

  async issue(
    input: ExecutionAuthorityIssueInput,
  ): Promise<IssuedExecutionAuthority> {
    const authority = ExecutionAuthorityIssueInputSchema.parse(input);
    if (authority.mcp && !this.#config.mcp) {
      throw new Error(
        'Execution authority cannot issue an MCP capability without MCP deployment configuration.',
      );
    }

    const issuedAt = toEpochSeconds(this.#now());
    const executionExpiresAt = issuedAt + this.#config.executionTtlSeconds;
    const executionAssertion = await this.#signExecutionAssertion(
      authority,
      issuedAt,
      executionExpiresAt,
    );

    const mcp = authority.mcp && this.#config.mcp
      ? await this.#issueMcpCapability(
        { ...authority, mcp: authority.mcp },
        issuedAt,
      )
      : undefined;

    return new ProtectedIssuedExecutionAuthority(
      executionAssertion,
      mcp?.assertion,
      freezeIssuedMetadata({
        scope: {
          adopterId: this.#config.adopterId,
          ...authority.scope,
        },
        runtimeSessionId: authority.runtimeSessionId,
        invocationId: authority.invocationId,
        workflow: authority.workflow,
        issuedAt: toIsoTimestamp(issuedAt),
        executionExpiresAt: toIsoTimestamp(executionExpiresAt),
        ...(mcp ? { mcp: mcp.metadata } : {}),
      }),
    );
  }

  publicJwks(): JSONWebKeySet {
    return { keys: [{ ...this.#publicJwk }] };
  }

  #signExecutionAssertion(
    input: z.infer<typeof ExecutionAuthorityIssueInputSchema>,
    issuedAt: number,
    expiresAt: number,
  ): Promise<string> {
    return new SignJWT({
      contractVersion: EXECUTION_CONTRACT_VERSION,
      adopterId: this.#config.adopterId,
      tenantId: input.scope.tenantId,
      productSessionId: input.scope.productSessionId,
      runtimeSessionId: input.runtimeSessionId,
      workflow: input.workflow,
    })
      .setProtectedHeader({
        alg: SIGNING_ALGORITHM,
        kid: this.#config.keyId,
        typ: EXECUTION_ASSERTION_TYPE,
      })
      .setIssuer(this.#config.issuer)
      .setAudience(this.#config.executionAudience)
      .setSubject(input.scope.subjectId)
      .setJti(input.invocationId)
      .setIssuedAt(issuedAt)
      .setExpirationTime(expiresAt)
      .sign(this.#privateKey);
  }

  async #issueMcpCapability(
    input: z.infer<typeof ExecutionAuthorityIssueInputSchema> & {
      mcp: { allowedTools: string[] };
    },
    issuedAt: number,
  ): Promise<{
    assertion: string;
    metadata: NonNullable<IssuedExecutionAuthorityMetadata['mcp']>;
  }> {
    const mcpConfig = this.#config.mcp!;
    const capabilityId = OpaqueIdSchema.parse(this.#createCapabilityId());
    if (capabilityId === input.invocationId) {
      throw new Error(
        'MCP capability identity must be distinct from the invocation identity.',
      );
    }
    const expiresAt = issuedAt + mcpConfig.ttlSeconds;
    const assertion = await new SignJWT({
      contractVersion: EXECUTION_CONTRACT_VERSION,
      adopterId: this.#config.adopterId,
      tenantId: input.scope.tenantId,
      productSessionId: input.scope.productSessionId,
      runtimeSessionId: input.runtimeSessionId,
      invocationId: input.invocationId,
      workflow: input.workflow,
      serverId: mcpConfig.serverId,
      allowedTools: [...input.mcp.allowedTools],
    })
      .setProtectedHeader({
        alg: SIGNING_ALGORITHM,
        kid: this.#config.keyId,
        typ: MCP_CAPABILITY_TYPE,
      })
      .setIssuer(this.#config.issuer)
      .setAudience(mcpConfig.audience)
      .setSubject(input.scope.subjectId)
      .setJti(capabilityId)
      .setIssuedAt(issuedAt)
      .setExpirationTime(expiresAt)
      .sign(this.#privateKey);

    return {
      assertion,
      metadata: {
        capabilityId,
        serverId: mcpConfig.serverId,
        allowedTools: Object.freeze([...input.mcp.allowedTools]),
        expiresAt: toIsoTimestamp(expiresAt),
      },
    };
  }
}

class ProtectedIssuedExecutionAuthority implements IssuedExecutionAuthority {
  readonly metadata: IssuedExecutionAuthorityMetadata;
  readonly #executionAssertion: string;
  readonly #mcpCapability: string | undefined;

  constructor(
    executionAssertion: string,
    mcpCapability: string | undefined,
    metadata: IssuedExecutionAuthorityMetadata,
  ) {
    this.#executionAssertion = executionAssertion;
    this.#mcpCapability = mcpCapability;
    this.metadata = metadata;
  }

  executionAssertion(): string {
    return this.#executionAssertion;
  }

  mcpCapability(): string | undefined {
    return this.#mcpCapability;
  }

  toJSON(): IssuedExecutionAuthorityMetadata {
    return this.metadata;
  }
}

function projectPublicJwk(jwk: JWK, keyId: string): Readonly<JWK> {
  const parsed = PublicP256JwkSchema.parse(jwk);
  return Object.freeze({
    kty: parsed.kty,
    crv: parsed.crv,
    x: parsed.x,
    y: parsed.y,
    alg: SIGNING_ALGORITHM,
    kid: keyId,
    use: 'sig',
  });
}

function assertPrivateSigningKey(key: CryptoKey): void {
  const algorithm = key.algorithm as { name: string; namedCurve?: string };
  const accepted = key.type === 'private'
    && algorithm.name === 'ECDSA'
    && algorithm.namedCurve === 'P-256'
    && key.usages.includes('sign');
  if (!accepted) {
    throw new Error(
      'Execution authority requires an ES256 private signing key.',
    );
  }
}

function assertPublicVerificationKey(key: CryptoKey): void {
  const algorithm = key.algorithm as { name: string; namedCurve?: string };
  const accepted = key.type === 'public'
    && algorithm.name === 'ECDSA'
    && algorithm.namedCurve === 'P-256'
    && key.usages.includes('verify');
  if (!accepted) {
    throw new Error(
      'Execution authority requires an ES256 public verification key.',
    );
  }
}

async function assertMatchingKeyPair(
  keyPair: ExecutionAuthorityKeyPair,
): Promise<void> {
  try {
    const probe = await new CompactSign(
      new TextEncoder().encode('heddle-adopter-execution-authority-key-pair'),
    )
      .setProtectedHeader({ alg: SIGNING_ALGORITHM })
      .sign(keyPair.privateKey);
    await compactVerify(probe, keyPair.publicKey, {
      algorithms: [SIGNING_ALGORITHM],
    });
  } catch {
    throw new Error('Execution authority signing keys do not match.');
  }
}

function toEpochSeconds(value: Date): number {
  const seconds = Math.floor(value.getTime() / 1_000);
  if (!Number.isSafeInteger(seconds) || seconds < 0) {
    throw new Error('Execution authority could not resolve a valid issue time.');
  }
  return seconds;
}

function toIsoTimestamp(epochSeconds: number): string {
  return new Date(epochSeconds * 1_000).toISOString();
}

function deepFreezeConfig(
  config: z.infer<typeof ExecutionAuthorityConfigSchema>,
): z.infer<typeof ExecutionAuthorityConfigSchema> {
  const mcp = config.mcp ? Object.freeze({ ...config.mcp }) : undefined;
  return Object.freeze({ ...config, ...(mcp ? { mcp } : {}) });
}

function freezeIssuedMetadata(
  metadata: IssuedExecutionAuthorityMetadata,
): IssuedExecutionAuthorityMetadata {
  const scope: ExecutionScope = Object.freeze({ ...metadata.scope });
  const mcp = metadata.mcp
    ? Object.freeze({
      ...metadata.mcp,
      allowedTools: Object.freeze([...metadata.mcp.allowedTools]),
    })
    : undefined;
  return Object.freeze({ ...metadata, scope, ...(mcp ? { mcp } : {}) });
}
