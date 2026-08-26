import { describe, expect, it } from 'vitest';
import {
  MemoryScopeIdentitySchema,
  deriveMemoryScopeId,
} from '@/core/memory/scope.js';

const identity = {
  adopterId: 'lucid',
  tenantId: 'tenant-a',
  subjectId: 'user-a',
  owner: { kind: 'agent', id: 'agent-a' },
} as const;

describe('deriveMemoryScopeId', () => {
  it('derives one stable opaque v1 id from verified identity and owner', () => {
    const scopeId = deriveMemoryScopeId(identity);

    expect(scopeId).toBe(
      'memory-v1-f6c317c8362c7f6a261782e0c296239075d478fdbf9e861bc6a7a5c3ffc50a97',
    );
    expect(scopeId).not.toContain(identity.tenantId);
    expect(scopeId).not.toContain(identity.subjectId);
    expect(scopeId).not.toContain(identity.owner.id);
  });

  it('isolates adopters, tenants, subjects, and agent or workspace owners', () => {
    const scopeIds = [
      identity,
      { ...identity, adopterId: 'another-adopter' },
      { ...identity, tenantId: 'tenant-b' },
      { ...identity, subjectId: 'user-b' },
      { ...identity, owner: { kind: 'agent', id: 'agent-b' } as const },
      { ...identity, owner: { kind: 'workspace', id: 'agent-a' } as const },
    ].map(deriveMemoryScopeId);

    expect(new Set(scopeIds)).toHaveLength(scopeIds.length);
  });

  it('rejects session identifiers and malformed identity instead of folding them into memory scope', () => {
    expect(() => MemoryScopeIdentitySchema.parse({
      ...identity,
      productSessionId: 'conversation-a',
      runtimeSessionId: 'runtime-a',
    })).toThrow();
    expect(() => deriveMemoryScopeId({
      ...identity,
      subjectId: ' user-a ',
    })).toThrow('must not contain outer whitespace');
  });
});
