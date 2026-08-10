import { readFile } from 'node:fs/promises';
import {
  SignJWT,
  createLocalJWKSet,
  decodeJwt,
  exportJWK,
  generateKeyPair,
  type CryptoKey,
} from 'jose';
import { describe, expect, it } from 'vitest';
import { JoseExecutionAuthority } from '../authority/index.js';
import {
  ExecutionHostConversationTurnRequestSchema,
  MCP_CAPABILITY_TYPE,
  type ExecutionAssertionClaims,
  type ExecutionHostStreamEvent,
  type McpCapabilityClaims,
} from '../contracts/index.js';
import {
  DirectHttpExecutionHost,
  ExecutionHostProtocolError,
  ExecutionHostStreamInterruptedError,
  type ExecutionHostConversationTurn,
} from '../http-sse/index.js';
import {
  JwtMcpCapabilityVerifier,
  McpCapabilityVerificationError,
} from '../mcp/index.js';

const fixtureRoot = new URL('../../spec/v1/fixtures/', import.meta.url);

describe('language-neutral golden fixtures', () => {
  it('accepts only the strict authority-free request body', async () => {
    const valid = await readJson('valid-request.json');
    const invalid = await readJson('invalid-request-extra-field.json');

    expect(ExecutionHostConversationTurnRequestSchema.safeParse(valid).success)
      .toBe(true);
    expect(ExecutionHostConversationTurnRequestSchema.safeParse(invalid).success)
      .toBe(false);
  });

  it.each([
    ['valid-result.sse', ['accepted', 'activity', 'result']],
    ['cancelled.sse', ['accepted', 'cancelled']],
  ])('consumes %s as a complete ordered stream', async (file, kinds) => {
    const events = await collect(createHost(await readText(file)));
    expect(events.map((event) => event.kind)).toEqual(kinds);
  });

  it('classifies missing terminal and sequence gaps without inferring success', async () => {
    await expect(collect(createHost(await readText('ambiguous-eof.sse'))))
      .rejects.toBeInstanceOf(ExecutionHostStreamInterruptedError);
    await expect(collect(createHost(
      await readText('invalid-sequence-gap.sse'),
    ))).rejects.toBeInstanceOf(ExecutionHostProtocolError);
  });

  it('issues claims matching the shared authority vector', async () => {
    const fixture = await authorityFixture();
    const keyPair = await generateKeyPair('ES256');
    const authority = await JoseExecutionAuthority.create({
      issuer: fixture.issuer,
      adopterId: fixture.expected.executionClaims.adopterId,
      executionAudience: fixture.executionAudience,
      keyId: fixture.keyId,
      executionTtlSeconds: 300,
      mcp: {
        audience: fixture.mcpAudience,
        serverId: fixture.expected.mcpClaims.serverId,
        ttlSeconds: 600,
      },
    }, keyPair, {
      now: () => new Date(fixture.referenceTime),
      createCapabilityId: () => fixture.expected.mcpClaims.jti,
    });
    const issued = await authority.issue({
      scope: {
        tenantId: fixture.expected.executionClaims.tenantId,
        subjectId: fixture.expected.executionClaims.sub,
        productSessionId: fixture.expected.executionClaims.productSessionId,
      },
      runtimeSessionId: fixture.expected.executionClaims.runtimeSessionId,
      invocationId: fixture.expected.executionClaims.jti,
      workflow: 'conversation-turn',
      mcp: { allowedTools: fixture.expected.mcpClaims.allowedTools },
    });

    expect(decodeJwt(issued.executionAssertion())).toEqual(
      fixture.expected.executionClaims,
    );
    expect(decodeJwt(issued.mcpCapability()!)).toEqual(
      fixture.expected.mcpClaims,
    );
    const verifier = createVerifier(fixture, authority.publicJwks());
    await expect(verifier.verify(issued.mcpCapability()!)).resolves.toMatchObject({
      scope: {
        tenantId: fixture.expected.mcpClaims.tenantId,
        runtimeSessionId: fixture.expected.mcpClaims.runtimeSessionId,
        invocationId: fixture.expected.mcpClaims.invocationId,
      },
      allowedTools: fixture.expected.mcpClaims.allowedTools,
    });
  });

  it('executes expiry, unsupported-tool, and swapped-scope cases', async () => {
    const fixture = await authorityFixture();
    const keyPair = await generateKeyPair('ES256');
    const verifier = createVerifier(fixture, {
      keys: [{
        ...await exportJWK(keyPair.publicKey),
        alg: 'ES256',
        kid: fixture.keyId,
        use: 'sig',
      }],
    });
    const cases = Object.fromEntries(
      fixture.invalidMcpCases.map((testCase) => [testCase.id, testCase]),
    );
    const expired = await signCapability(
      fixture,
      keyPair.privateKey,
      cases.expired!.overrides,
    );
    const unsupported = await signCapability(
      fixture,
      keyPair.privateKey,
      cases['unsupported-tool']!.overrides,
    );
    const swapped = await signCapability(
      fixture,
      keyPair.privateKey,
      cases['swapped-runtime-session']!.overrides,
    );

    await expect(verifier.verify(expired)).rejects.toBeInstanceOf(
      McpCapabilityVerificationError,
    );
    await expect(verifier.verify(unsupported)).rejects.toBeInstanceOf(
      McpCapabilityVerificationError,
    );
    const swappedClaims = decodeJwt(swapped) as McpCapabilityClaims;
    expect(authorityClaimsMatch(
      fixture.expected.executionClaims,
      swappedClaims,
    )).toBe(false);
  });
});

type AuthorityFixture = {
  referenceTime: string;
  issuer: string;
  keyId: string;
  executionAudience: string;
  mcpAudience: string;
  supportedTools: string[];
  expected: {
    executionClaims: ExecutionAssertionClaims;
    mcpClaims: McpCapabilityClaims;
  };
  invalidMcpCases: Array<{
    id: string;
    overrides: Partial<McpCapabilityClaims>;
    expected: string;
  }>;
};

async function authorityFixture(): Promise<AuthorityFixture> {
  return await readJson('authority.json') as unknown as AuthorityFixture;
}

function createVerifier(
  fixture: AuthorityFixture,
  jwks: Parameters<typeof createLocalJWKSet>[0],
): JwtMcpCapabilityVerifier<string> {
  return new JwtMcpCapabilityVerifier({
    issuer: fixture.issuer,
    audience: fixture.mcpAudience,
    jwksUrl: new URL(`${fixture.issuer}/.well-known/jwks.json`),
    trustedAdopterId: fixture.expected.executionClaims.adopterId,
    serverId: fixture.expected.mcpClaims.serverId,
    supportedTools: fixture.supportedTools,
    maxCapabilityAgeSeconds: 15 * 60,
    clockToleranceSeconds: 0,
  }, {
    keyResolver: createLocalJWKSet(jwks),
    now: () => new Date(fixture.referenceTime),
  });
}

async function signCapability(
  fixture: AuthorityFixture,
  privateKey: CryptoKey,
  overrides: Partial<McpCapabilityClaims>,
): Promise<string> {
  const claims = { ...fixture.expected.mcpClaims, ...overrides };
  return new SignJWT({
    contractVersion: claims.contractVersion,
    adopterId: claims.adopterId,
    tenantId: claims.tenantId,
    productSessionId: claims.productSessionId,
    runtimeSessionId: claims.runtimeSessionId,
    invocationId: claims.invocationId,
    workflow: claims.workflow,
    serverId: claims.serverId,
    allowedTools: claims.allowedTools,
  })
    .setProtectedHeader({
      alg: 'ES256',
      kid: fixture.keyId,
      typ: MCP_CAPABILITY_TYPE,
    })
    .setIssuer(fixture.issuer)
    .setAudience(fixture.mcpAudience)
    .setSubject(claims.sub)
    .setJti(claims.jti)
    .setIssuedAt(claims.iat)
    .setExpirationTime(claims.exp)
    .sign(privateKey);
}

function authorityClaimsMatch(
  execution: ExecutionAssertionClaims,
  capability: McpCapabilityClaims,
): boolean {
  return execution.adopterId === capability.adopterId
    && execution.tenantId === capability.tenantId
    && execution.productSessionId === capability.productSessionId
    && execution.runtimeSessionId === capability.runtimeSessionId
    && execution.workflow === capability.workflow
    && execution.sub === capability.sub
    && execution.jti === capability.invocationId;
}

function createHost(sse: string): DirectHttpExecutionHost {
  return new DirectHttpExecutionHost({
    baseUrl: new URL('http://127.0.0.1:8080'),
    localToken: 'local-runtime-token',
    fetch: (async () => new Response(sse, {
      headers: { 'content-type': 'text/event-stream' },
    })) as typeof fetch,
  });
}

async function collect(
  host: DirectHttpExecutionHost,
): Promise<ExecutionHostStreamEvent[]> {
  const events: ExecutionHostStreamEvent[] = [];
  for await (const event of host.streamConversationTurn(input())) {
    events.push(event);
  }
  return events;
}

function input(): ExecutionHostConversationTurn {
  return {
    invocationId: 'invocation-001',
    runtimeSessionId: `runtime-session:${'a'.repeat(40)}`,
    prompt: 'Summarize the current product state.',
    executionAssertion: 'execution-assertion'.padEnd(32, 'x'),
    mcpCapability: 'mcp-capability'.padEnd(32, 'x'),
    modelApiKey: 'model-api-key',
  };
}

async function readJson(file: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readText(file)) as Record<string, unknown>;
}

function readText(file: string): Promise<string> {
  return readFile(new URL(file, fixtureRoot), 'utf8');
}
