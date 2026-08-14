import {
  SignJWT,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type CryptoKey,
  type JSONWebKeySet,
  type JWTVerifyGetKey,
} from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  MCP_CAPABILITY_TYPE,
} from '../contracts/index.js';
import {
  JwtMcpCapabilityVerifier,
  McpCapabilityVerificationError,
  assertMcpCapabilityActive,
} from '../mcp/index.js';

const NOW = new Date('2026-08-10T05:00:00.000Z');
const NOW_SECONDS = Math.floor(NOW.getTime() / 1_000);

let privateKey: CryptoKey;
let jwks: JSONWebKeySet;

beforeAll(async () => {
  const pair = await generateKeyPair('ES256');
  privateKey = pair.privateKey;
  jwks = {
    keys: [{
      ...await exportJWK(pair.publicKey),
      alg: 'ES256',
      kid: 'test-key',
      use: 'sig',
    }],
  };
});

describe('product MCP capability verifier', () => {
  it('derives a deeply immutable scope from a valid capability', async () => {
    const capability = await verifier().verify(await sign());

    expect(capability).toEqual({
      capabilityId: 'capability-001',
      serverId: 'product_capabilities',
      allowedTools: ['read_snapshot'],
      scope: {
        adopterId: 'example-adopter',
        tenantId: 'tenant-a',
        subjectId: 'subject-a',
        productSessionId: 'product-session-a',
        runtimeSessionId: runtimeSessionId(),
        invocationId: 'invocation-001',
        workflow: 'conversation-turn',
      },
      issuedAt: NOW.toISOString(),
      expiresAt: new Date((NOW_SECONDS + 60) * 1_000).toISOString(),
    });
    expect(Object.isFrozen(capability)).toBe(true);
    expect(Object.isFrozen(capability.scope)).toBe(true);
    expect(Object.isFrozen(capability.allowedTools)).toBe(true);
    expect(() => assertMcpCapabilityActive(capability, NOW)).not.toThrow();
  });

  it.each([
    ['untrusted adopter', { adopterId: 'other-adopter' }],
    ['wrong server', { serverId: 'another_server' }],
    ['unsupported tool', { allowedTools: ['delete_workspace'] }],
    ['duplicate tool', { allowedTools: ['read_snapshot', 'read_snapshot'] }],
    ['unsafe tool', { allowedTools: ['read.snapshot'] }],
    ['reused invocation ID', { invocationId: 'same', capabilityId: 'same' }],
    ['wrong token type', { typ: 'not-an-mcp-capability' }],
    ['wrong audience', { audience: 'urn:another:mcp' }],
    ['wrong issuer', { issuer: 'https://another.example.test' }],
    ['overlong lifetime', { expiresAt: NOW_SECONDS + 301 }],
    ['non-positive lifetime', { expiresAt: NOW_SECONDS }],
  ])('rejects %s with a stable safe error', async (_label, overrides) => {
    await expect(verifier().verify(await sign(overrides))).rejects.toEqual(
      expect.objectContaining({
        name: 'McpCapabilityVerificationError',
        message: 'MCP capability verification failed.',
      }),
    );
  });

  it('rejects an expired capability and supports explicit per-operation expiry checks', async () => {
    const assertion = await sign({ expiresAt: NOW_SECONDS + 10 });
    await expect(verifier(
      () => new Date((NOW_SECONDS + 13) * 1_000),
    ).verify(assertion)).rejects.toBeInstanceOf(
      McpCapabilityVerificationError,
    );

    const capability = await verifier().verify(assertion);
    expect(() => assertMcpCapabilityActive(
      capability,
      new Date((NOW_SECONDS + 10) * 1_000),
    )).toThrow(McpCapabilityVerificationError);
  });

  it('distinguishes verification dependency outages from invalid credentials', async () => {
    const unavailable = verifier(
      () => NOW,
      async () => {
        throw new TypeError('network is unavailable');
      },
    );
    await expect(unavailable.verify(await sign())).rejects.toEqual(
      expect.objectContaining({
        name: 'McpCapabilityUnavailableError',
        category: 'network',
      }),
    );
  });

  it.each([
    ['plaintext remote issuer', { issuer: 'http://api.example.test' }],
    ['credential-bearing JWKS', {
      jwksUrl: new URL('https://user:secret@api.example.test/jwks'),
    }],
    ['JWKS query', {
      jwksUrl: new URL('https://api.example.test/jwks?token=secret'),
    }],
    ['empty supported tools', { supportedTools: [] }],
    ['zero capability age', { maxCapabilityAgeSeconds: 0 }],
    ['excessive clock tolerance', { clockToleranceSeconds: 61 }],
  ])('rejects %s configuration', (_label, override) => {
    expect(() => verifier(() => NOW, undefined, override)).toThrow();
  });
});

function verifier(
  now: () => Date = () => NOW,
  keyResolver?: JWTVerifyGetKey,
  overrides: Record<string, unknown> = {},
) {
  return new JwtMcpCapabilityVerifier({
    issuer: 'https://api.example.test',
    audience: 'urn:example:mcp',
    jwksUrl: new URL('https://api.example.test/.well-known/jwks.json'),
    trustedAdopterId: 'example-adopter',
    serverId: 'product_capabilities',
    supportedTools: ['read_snapshot'] as const,
    maxCapabilityAgeSeconds: 300,
    clockToleranceSeconds: 2,
    ...overrides,
  }, {
    keyResolver: keyResolver ?? createLocalJWKSet(jwks),
    now,
  });
}

async function sign(overrides: Record<string, unknown> = {}): Promise<string> {
  const values = {
    issuer: 'https://api.example.test',
    audience: 'urn:example:mcp',
    typ: MCP_CAPABILITY_TYPE,
    issuedAt: NOW_SECONDS,
    expiresAt: NOW_SECONDS + 60,
    capabilityId: 'capability-001',
    adopterId: 'example-adopter',
    tenantId: 'tenant-a',
    subjectId: 'subject-a',
    productSessionId: 'product-session-a',
    runtimeSessionId: runtimeSessionId(),
    invocationId: 'invocation-001',
    serverId: 'product_capabilities',
    allowedTools: ['read_snapshot'],
    ...overrides,
  };
  return new SignJWT({
    contractVersion: 1,
    adopterId: values.adopterId,
    tenantId: values.tenantId,
    productSessionId: values.productSessionId,
    runtimeSessionId: values.runtimeSessionId,
    invocationId: values.invocationId,
    workflow: 'conversation-turn',
    serverId: values.serverId,
    allowedTools: values.allowedTools,
  })
    .setProtectedHeader({ alg: 'ES256', kid: 'test-key', typ: String(values.typ) })
    .setIssuer(String(values.issuer))
    .setAudience(String(values.audience))
    .setSubject(String(values.subjectId))
    .setJti(String(values.capabilityId))
    .setIssuedAt(Number(values.issuedAt))
    .setExpirationTime(Number(values.expiresAt))
    .sign(privateKey);
}

function runtimeSessionId(): string {
  return `runtime-session:${'a'.repeat(40)}`;
}
