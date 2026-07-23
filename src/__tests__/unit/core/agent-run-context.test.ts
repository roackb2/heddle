import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAX_STEPS,
  DEFAULT_MAX_TOOL_CONCURRENCY,
} from '@/core/agent/constants.js';
import { AgentRunContextBuilder } from '@/core/agent/context/index.js';
import type { LlmAdapter } from '@/core/llm/types.js';

const fakeLlm: LlmAdapter = {
  async chat() {
    return { content: 'done' };
  },
};

describe('AgentRunContextBuilder', () => {
  it('uses a practical no-limit default when maxSteps is omitted', () => {
    const context = AgentRunContextBuilder.create({
      goal: 'Do a long task.',
      llm: fakeLlm,
      tools: [],
    });

    expect(context.maxSteps).toBe(DEFAULT_MAX_STEPS);
    expect(context.maxSteps).toBe(Number.MAX_SAFE_INTEGER);
    expect(context.maxToolConcurrency).toBe(DEFAULT_MAX_TOOL_CONCURRENCY);
  });

  it('still honors explicit host step budgets', () => {
    const context = AgentRunContextBuilder.create({
      goal: 'Do a bounded task.',
      llm: fakeLlm,
      maxSteps: 3,
      tools: [],
    });

    expect(context.maxSteps).toBe(3);
  });

  it('honors an explicit tool concurrency limit', () => {
    const context = AgentRunContextBuilder.create({
      goal: 'Do bounded parallel reads.',
      llm: fakeLlm,
      maxToolConcurrency: 1,
      tools: [],
    });

    expect(context.maxToolConcurrency).toBe(1);
  });

  it.each([0, 1.5, 33])(
    'rejects invalid tool concurrency limit %s',
    (maxToolConcurrency) => {
      expect(() =>
        AgentRunContextBuilder.create({
          goal: 'Reject an invalid scheduler configuration.',
          llm: fakeLlm,
          maxToolConcurrency,
          tools: [],
        }),
      ).toThrow('maxToolConcurrency must be an integer between 1 and 32');
    },
  );
});
