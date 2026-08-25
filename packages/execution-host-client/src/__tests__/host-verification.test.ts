import { createLocalJWKSet, generateKeyPair, type CryptoKey } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { JoseExecutionAuthority } from '../authority/index.js';
import {
  ExecutionHostMcpCapabilityVerificationError,
  ExecutionIdentityUnavailableError,
  ExecutionIdentityVerificationError,
  JwtExecutionHostMcpCapabilityVerifier,
  JwtExecutionIdentityVerifier,
} from '../host/index.js';

const NOW = new Date('2026-08-25T12:00:00.000Z');
const RUNTIME_SESSION_ID = 'runtime-session-'.padEnd(33, 's');

let privateKey: CryptoKey;
let publicKey: CryptoKey;

beforeAll(async () => {
  const pair = await generateKeyPair('ES256');
  privateKey = pair.privateKey;
  publicKey = pair.publicKey;
});

describe('Execution Host authority verification', () => {
  it('binds execution and MCP authority to one verified invocation', async () => {
    const { authority, execution, mcp } = await createVerificationFixture();
    const issued = await authority.issue({
      scope: {
        tenantId: 'tenant-a',
        subjectId: 'user-a',
        productSessionId: 'conversation-a',
      },
      runtimeSessionId: RUNTIME_SESSION_ID,
      invocationId: 'invocation-a',
      workflow: 'conversation-turn',
      mcp: { allowedTools: ['read_snapshot'] },
    });

    const identity = await execution.verify({
      assertion: issued.executionAssertion(),
      runtimeSessionId: RUNTIME_SESSION_ID,
      invocationId: 'invocation-a',
      workflow: 'conversation-turn',
    });
    const capability = await mcp.verify({
      assertion: issued.mcpCapability()!,
      identity,
    });

    expect(identity).toMatchObject({
      scope: {
        adopterId: 'example-adopter',
        tenantId: 'tenant-a',
        subjectId: 'user-a',
        productSessionId: 'conversation-a',
      },
      runtimeSessionId: RUNTIME_SESSION_ID,
      invocationId: 'invocation-a',
      workflow: 'conversation-turn',
    });
    expect(capability).toMatchObject({
      serverId: 'product_capabilities',
      allowedTools: ['read_snapshot'],
    });
    expect(capability.assertion).toBe(issued.mcpCapability());
  });

  it('rejects request and capability scope mismatches', async () => {
    const { authority, execution, mcp } = await createVerificationFixture();
    const issued = await authority.issue({
      scope: {
        tenantId: 'tenant-a',
        subjectId: 'user-a',
        productSessionId: 'conversation-a',
      },
      runtimeSessionId: RUNTIME_SESSION_ID,
      invocationId: 'invocation-a',
      workflow: 'conversation-turn',
      mcp: { allowedTools: ['read_snapshot'] },
    });

    await expect(execution.verify({
      assertion: issued.executionAssertion(),
      runtimeSessionId: RUNTIME_SESSION_ID,
      invocationId: 'invocation-b',
      workflow: 'conversation-turn',
    })).rejects.toBeInstanceOf(ExecutionIdentityVerificationError);

    const identity = await execution.verify({
      assertion: issued.executionAssertion(),
      runtimeSessionId: RUNTIME_SESSION_ID,
      invocationId: 'invocation-a',
      workflow: 'conversation-turn',
    });
    await expect(mcp.verify({
      assertion: issued.mcpCapability()!,
      identity: {
        ...identity,
        scope: { ...identity.scope, tenantId: 'tenant-b' },
      },
    })).rejects.toBeInstanceOf(
      ExecutionHostMcpCapabilityVerificationError,
    );
  });

  it('classifies unavailable key resolution without exposing its cause', async () => {
    const { authority } = await createVerificationFixture();
    const issued = await authority.issue({
      scope: {
        tenantId: 'tenant-a',
        subjectId: 'user-a',
        productSessionId: 'conversation-a',
      },
      runtimeSessionId: RUNTIME_SESSION_ID,
      invocationId: 'invocation-a',
      workflow: 'conversation-turn',
    });
    const verifier = new JwtExecutionIdentityVerifier(executionConfig(), {
      keyResolver: () => Promise.reject(new TypeError('private network detail')),
      now: () => NOW,
    });

    await expect(verifier.verify({
      assertion: issued.executionAssertion(),
      runtimeSessionId: RUNTIME_SESSION_ID,
      invocationId: 'invocation-a',
      workflow: 'conversation-turn',
    })).rejects.toMatchObject({
      name: 'ExecutionIdentityUnavailableError',
      category: 'network',
      message: 'Execution identity verification is temporarily unavailable.',
    } satisfies Partial<ExecutionIdentityUnavailableError>);
  });
});

async function createVerificationFixture() {
  const authority = await JoseExecutionAuthority.create({
    issuer: 'https://api.example.test',
    adopterId: 'example-adopter',
    executionAudience: 'urn:heddle-execution-host:example',
    keyId: 'authority-key',
    executionTtlSeconds: 300,
    mcp: {
      audience: 'urn:example:mcp',
      serverId: 'product_capabilities',
      ttlSeconds: 600,
    },
  }, { privateKey, publicKey }, {
    now: () => NOW,
    createCapabilityId: () => 'capability-a',
  });
  const options = {
    keyResolver: createLocalJWKSet(authority.publicJwks()),
    now: () => NOW,
  };

  return {
    authority,
    execution: new JwtExecutionIdentityVerifier(executionConfig(), options),
    mcp: new JwtExecutionHostMcpCapabilityVerifier({
      issuer: 'https://api.example.test',
      audience: 'urn:example:mcp',
      jwksUrl: new URL('https://api.example.test/.well-known/jwks.json'),
      jwtAlgorithms: ['ES256'],
      trustedAdopterId: 'example-adopter',
      serverId: 'product_capabilities',
      maxCapabilityAgeSeconds: 900,
      clockToleranceSeconds: 2,
    }, options),
  };
}

function executionConfig() {
  return {
    executionIssuer: 'https://api.example.test',
    executionAudience: 'urn:heddle-execution-host:example',
    executionJwksUrl: new URL('https://api.example.test/.well-known/jwks.json'),
    executionJwtAlgorithms: ['ES256'] as const,
    trustedAdopterId: 'example-adopter',
    maxAssertionAgeSeconds: 300,
    assertionClockToleranceSeconds: 2,
  };
}
