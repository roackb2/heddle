import { describe, expect, it } from 'vitest';
import { createAwarenessService } from '../../../core/awareness/service.js';
import { createCodingAwarenessProvider } from '../../../core/awareness/domains/coding/provider.js';

describe('awareness service', () => {
  it('routes collection through the registered provider and preserves canonical snapshot fields', async () => {
    const service = createAwarenessService({
      providers: [createCodingAwarenessProvider({
        now: () => new Date('2026-05-11T10:00:00.000Z'),
        nextId: () => 'awareness-test-id',
      })],
    });

    const snapshot = await service.collect({
      domain: 'coding',
      profile: 'working_environment',
      workspaceRoot: '/workspace/sample',
    });

    expect(snapshot).toMatchObject({
      id: 'awareness-test-id',
      domain: 'coding',
      profile: 'working_environment',
      collectedAt: '2026-05-11T10:00:00.000Z',
      workspaceRoot: '/workspace/sample',
      sections: [expect.objectContaining({ type: 'working_environment' })],
      sources: expect.any(Array),
      limits: expect.any(Array),
    });
  });

  it('fails clearly when no provider is registered for the requested domain', async () => {
    const service = createAwarenessService({ providers: [] });

    await expect(service.collect({
      domain: 'coding',
      profile: 'working_environment',
      workspaceRoot: '/workspace/sample',
    })).rejects.toThrow('No awareness provider registered for domain: coding');
  });
});
