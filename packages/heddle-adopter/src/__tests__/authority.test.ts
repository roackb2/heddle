import {
  createLocalJWKSet,
  decodeProtectedHeader,
  generateKeyPair,
  jwtVerify,
  type CryptoKey,
} from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  EXECUTION_ASSERTION_TYPE,
  MCP_CAPABILITY_TYPE,
} from '../contracts/index.js';
import { JwtMcpCapabilityVerifier } from '../mcp/index.js';
import { JoseExecutionAuthority } from '../authority/jose-execution-authority.js';
import type {
  ExecutionAuthorityConfig,
  ExecutionAuthorityIssueInput,
} from '../authority/types.js';

const NOW = new Date('2026-08-10T04:00:00.000Z');
const NOW_SECONDS = Math.floor(NOW.getTime() / 1_000);
const KEY_ID = 'adopter-execution-2026-08';

let privateKey: CryptoKey;
let publicKey: CryptoKey;

beforeAll(async () => {
  const pair = await generateKeyPair('ES256');
  privateKey = pair.privateKey;
  publicKey = pair.publicKey;
});

describe('JOSE execution authority', () => {
  it('issues separately typed and scoped v1 execution and MCP authority', async () => {
    const authority = await createAuthority();
    const issued = await authority.issue(issueInput());
    const keyResolver = createLocalJWKSet(authority.publicJwks());

    const execution = await jwtVerify(issued.executionAssertion(), keyResolver, {
      algorithms: ['ES256'],
      audience: 'urn:heddle-execution-host:example',
      issuer: 'https://api.example.test',
      typ: EXECUTION_ASSERTION_TYPE,
      currentDate: NOW,
    });
    const capability = await jwtVerify(issued.mcpCapability()!, keyResolver, {
      algorithms: ['ES256'],
      audience: 'urn:example:mcp',
      issuer: 'https://api.example.test',
      typ: MCP_CAPABILITY_TYPE,
      currentDate: NOW,
    });

    expect(execution.payload).toMatchObject({
      contractVersion: 1,
      adopterId: 'example-adopter',
      tenantId: 'company-a',
      productSessionId: 'conversation-a',
      runtimeSessionId: runtimeSessionId(),
      workflow: 'conversation-turn',
      sub: 'user-a',
      jti: 'invocation-001',
      iat: NOW_SECONDS,
      exp: NOW_SECONDS + 300,
    });
    expect(capability.payload).toMatchObject({
      contractVersion: 1,
      adopterId: 'example-adopter',
      tenantId: 'company-a',
      productSessionId: 'conversation-a',
      runtimeSessionId: runtimeSessionId(),
      invocationId: 'invocation-001',
      workflow: 'conversation-turn',
      serverId: 'product_capabilities',
      allowedTools: ['read_snapshot'],
      sub: 'user-a',
      jti: 'capability-001',
      iat: NOW_SECONDS,
      exp: NOW_SECONDS + 600,
    });
    expect(decodeProtectedHeader(issued.executionAssertion())).toEqual({
      alg: 'ES256',
      kid: KEY_ID,
      typ: EXECUTION_ASSERTION_TYPE,
    });
    expect(decodeProtectedHeader(issued.mcpCapability()!)).toEqual({
      alg: 'ES256',
      kid: KEY_ID,
      typ: MCP_CAPABILITY_TYPE,
    });
  });

  it('supports execution-only adopters without MCP configuration', async () => {
    const authority = await createAuthority({ mcp: undefined });
    const issued = await authority.issue({ ...issueInput(), mcp: undefined });

    expect(issued.mcpCapability()).toBeUndefined();
    expect(issued.metadata.mcp).toBeUndefined();
    await expect(jwtVerify(
      issued.executionAssertion(),
      createLocalJWKSet(authority.publicJwks()),
      {
        algorithms: ['ES256'],
        audience: 'urn:heddle-execution-host:example',
        issuer: 'https://api.example.test',
        typ: EXECUTION_ASSERTION_TYPE,
        currentDate: NOW,
      },
    )).resolves.toBeDefined();
  });

  it('produces an MCP capability accepted by independent product-edge verification', async () => {
    const authority = await createAuthority();
    const issued = await authority.issue(issueInput());
    const verifier = new JwtMcpCapabilityVerifier({
      issuer: 'https://api.example.test',
      audience: 'urn:example:mcp',
      jwksUrl: new URL('https://api.example.test/.well-known/jwks.json'),
      trustedAdopterId: 'example-adopter',
      serverId: 'product_capabilities',
      supportedTools: ['read_snapshot'] as const,
      maxCapabilityAgeSeconds: 15 * 60,
      clockToleranceSeconds: 2,
    }, {
      keyResolver: createLocalJWKSet(authority.publicJwks()),
      now: () => NOW,
    });

    await expect(verifier.verify(issued.mcpCapability()!)).resolves.toEqual({
      capabilityId: 'capability-001',
      serverId: 'product_capabilities',
      allowedTools: ['read_snapshot'],
      scope: {
        adopterId: 'example-adopter',
        tenantId: 'company-a',
        subjectId: 'user-a',
        productSessionId: 'conversation-a',
        runtimeSessionId: runtimeSessionId(),
        invocationId: 'invocation-001',
        workflow: 'conversation-turn',
      },
      issuedAt: NOW.toISOString(),
      expiresAt: new Date((NOW_SECONDS + 600) * 1_000).toISOString(),
    });
  });

  it('publishes a defensive public projection and serializes no credentials', async () => {
    const authority = await createAuthority();
    const first = authority.publicJwks();
    first.keys[0]!.kid = 'caller-mutated';
    const second = authority.publicJwks();
    const issued = await authority.issue(issueInput());
    const serialized = JSON.stringify(issued);

    expect(second).toEqual({
      keys: [{
        kty: 'EC',
        crv: 'P-256',
        x: expect.any(String),
        y: expect.any(String),
        alg: 'ES256',
        kid: KEY_ID,
        use: 'sig',
      }],
    });
    expect(JSON.stringify(second)).not.toContain('"d"');
    expect(serialized).toContain('"invocationId":"invocation-001"');
    expect(serialized).not.toContain(issued.executionAssertion());
    expect(serialized).not.toContain(issued.mcpCapability()!);
    expect(Object.keys(issued)).toEqual(['metadata']);
    expect(Object.isFrozen(issued.metadata)).toBe(true);
    expect(Object.isFrozen(issued.metadata.scope)).toBe(true);
    expect(Object.isFrozen(issued.metadata.mcp?.allowedTools)).toBe(true);
  });

  it.each([
    ['caller-selected path identity', { invocationId: '../other' }],
    ['short runtime session', { runtimeSessionId: 'too-short' }],
    ['punctuated tool alias', { mcp: { allowedTools: ['read.scope'] } }],
    ['duplicate tool aliases', { mcp: { allowedTools: ['read_scope', 'read_scope'] } }],
  ])('rejects %s before signing', async (_label, override) => {
    const authority = await createAuthority();
    await expect(authority.issue({ ...issueInput(), ...override }))
      .rejects.toThrow();
  });

  it('requires separate audiences, identities, and configured MCP authority', async () => {
    await expect(createAuthority({
      mcp: {
        audience: 'urn:heddle-execution-host:example',
        serverId: 'product_capabilities',
        ttlSeconds: 600,
      },
    })).rejects.toThrow(/distinct/);

    const sameId = await createAuthority({}, () => 'invocation-001');
    await expect(sameId.issue(issueInput())).rejects.toThrow(/distinct/);

    const executionOnly = await createAuthority({ mcp: undefined });
    await expect(executionOnly.issue(issueInput())).rejects.toThrow(
      /without MCP deployment configuration/,
    );
  });

  it('keeps adopter identity in deployment policy rather than caller input', async () => {
    const authority = await createAuthority();
    await expect(authority.issue({
      ...issueInput(),
      scope: { ...issueInput().scope, adopterId: 'another-adopter' },
    } as unknown as ExecutionAuthorityIssueInput)).rejects.toThrow();
  });

  it('rejects mismatched signing keys and unsafe deployment configuration', async () => {
    const otherPair = await generateKeyPair('ES256');
    await expect(JoseExecutionAuthority.create(
      config(),
      { privateKey, publicKey: otherPair.publicKey },
    )).rejects.toThrow(/do not match/);

    await expect(createAuthority({ issuer: 'http://api.example.test' }))
      .rejects.toThrow(/HTTPS/);
    await expect(createAuthority({ issuer: 'https://api.example.test?token=x' }))
      .rejects.toThrow(/query/);
  });
});

function createAuthority(
  overrides: Partial<ExecutionAuthorityConfig> = {},
  createCapabilityId: () => string = () => 'capability-001',
): Promise<JoseExecutionAuthority> {
  return JoseExecutionAuthority.create(
    config(overrides),
    { privateKey, publicKey },
    { now: () => NOW, createCapabilityId },
  );
}

function config(
  overrides: Partial<ExecutionAuthorityConfig> = {},
): ExecutionAuthorityConfig {
  return {
    issuer: 'https://api.example.test',
    adopterId: 'example-adopter',
    executionAudience: 'urn:heddle-execution-host:example',
    keyId: KEY_ID,
    executionTtlSeconds: 300,
    mcp: {
      audience: 'urn:example:mcp',
      serverId: 'product_capabilities',
      ttlSeconds: 600,
    },
    ...overrides,
  };
}

function issueInput(): ExecutionAuthorityIssueInput {
  return {
    scope: {
      tenantId: 'company-a',
      subjectId: 'user-a',
      productSessionId: 'conversation-a',
    },
    runtimeSessionId: runtimeSessionId(),
    invocationId: 'invocation-001',
    workflow: 'conversation-turn',
    mcp: { allowedTools: ['read_snapshot'] },
  };
}

function runtimeSessionId(): string {
  return 'runtime-session-'.padEnd(33, 's');
}
