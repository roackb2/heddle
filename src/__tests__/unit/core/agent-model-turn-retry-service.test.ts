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

  it.each([undefined, 429])(
    'classifies structured insufficient_quota as non-retryable before status %s',
    (status) => {
      const decision = AgentModelTurnRetryService.resolve({
        kind: 'error',
        error: Object.assign(new Error('provider message'), {
          code: 'insufficient_quota',
          ...(status === undefined ? {} : { status }),
        }),
      });

      expect(decision).toEqual({
        retryable: false,
        failure: { source: 'model', code: 'quota' },
        maxAttempts: 1,
        message: 'Model provider quota or billing limit reached',
      });
    },
  );

  it('does not infer quota exhaustion from provider message text', () => {
    const decision = AgentModelTurnRetryService.resolve({
      kind: 'error',
      error: new Error('You exceeded your current quota, please check your billing details.'),
    });

    expect(decision.failure).toEqual({ source: 'model', code: 'unknown' });
  });

  it.each([
    'context_length_exceeded',
    'context_window_exceeded',
    'max_context_length_exceeded',
    'input_too_long',
    'prompt_too_long',
  ])('classifies provider context-overflow code %s without generic retries', (code) => {
    const providerSecret = 'provider-overflow-sentinel';
    const decision = AgentModelTurnRetryService.resolve({
      kind: 'error',
      error: {
        status: 400,
        response: {
          data: {
            error: {
              code,
              message: `Maximum context length reached: ${providerSecret}`,
            },
          },
        },
      },
    });

    expect(decision).toEqual({
      retryable: false,
      failure: { source: 'model', code: 'context_window' },
      maxAttempts: 1,
      message: 'Model context window was exceeded',
    });
    expect(JSON.stringify(decision)).not.toContain(providerSecret);
  });

  it('classifies a conservative context-overflow message when the provider omits a code', () => {
    const decision = AgentModelTurnRetryService.resolve({
      kind: 'error',
      error: Object.assign(new Error('Request rejected'), {
        status: 400,
        error: { message: 'This model maximum context length is 128000 tokens.' },
      }),
    });

    expect(decision.failure).toEqual({ source: 'model', code: 'context_window' });
    expect(decision.retryable).toBe(false);
  });

  it('does not classify every bad request as a context overflow', () => {
    const decision = AgentModelTurnRetryService.resolve({
      kind: 'error',
      error: Object.assign(new Error('Invalid tool schema'), { status: 400 }),
    });

    expect(decision.failure).toEqual({ source: 'model', code: 'request' });
  });
});
