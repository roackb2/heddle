import { describe, expect, it } from 'vitest';
import { evalCaseSchema } from '../../core/eval/schema.js';

describe('eval case schema', () => {
  it('parses a minimal coding eval case', () => {
    const parsed = evalCaseSchema.parse({
      id: 'minimal-case',
      kind: 'coding',
      prompt: 'Fix the bug.',
    });

    expect(parsed).toMatchObject({
      id: 'minimal-case',
      kind: 'coding',
      prompt: 'Fix the bug.',
      checks: [],
      rubric: [],
      tags: [],
    });
  });

  it('rejects unsafe case ids', () => {
    expect(() => evalCaseSchema.parse({
      id: '../outside',
      kind: 'coding',
      prompt: 'Fix the bug.',
    })).toThrow();
  });
});
