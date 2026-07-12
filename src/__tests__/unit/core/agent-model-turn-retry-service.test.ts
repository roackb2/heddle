import { describe, expect, it } from 'vitest';
import { AgentModelTurnRetryService } from '@/core/agent/model/index.js';

describe('AgentModelTurnRetryService', () => {
  it.each([
    [401, 'authentication', false],
    [403, 'permission', false],
    [400, 'request', false],
    [429, 'rate_limit', true],
    [503, 'transport', true],
    [418, 'unknown', false],
  ] as const)('classifies HTTP status %s as %s', (status, code, retryable) => {
    const decision = AgentModelTurnRetryService.resolve({
      kind: 'error',
      error: Object.assign(new Error('provider message'), { status }),
    });

    expect(decision).toMatchObject({
      retryable,
      failure: { source: 'model', code },
    });
    expect(decision.failure).not.toHaveProperty('message');
  });

  it('classifies network failures without exposing provider details', () => {
    const decision = AgentModelTurnRetryService.resolve({
      kind: 'error',
      error: Object.assign(new Error('fetch failed with secret-value'), { code: 'ECONNRESET' }),
    });

    expect(decision.failure).toEqual({ source: 'model', code: 'transport' });
    expect(decision.message).toBe('Model provider is temporarily unavailable');
    expect(decision.message).not.toContain('secret-value');
    expect(JSON.stringify(decision.failure)).not.toContain('secret-value');
  });
});
