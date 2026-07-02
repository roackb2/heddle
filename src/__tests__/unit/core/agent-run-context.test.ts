import { describe, expect, it } from 'vitest';
import { DEFAULT_MAX_STEPS } from '@/core/agent/constants.js';
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
});
