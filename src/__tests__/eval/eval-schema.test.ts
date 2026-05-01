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
      fixture: {
        type: 'inline',
      },
      rubric: [],
      tags: [],
    });
  });

  it('parses a pinned git worktree fixture', () => {
    const parsed = evalCaseSchema.parse({
      id: 'heddle-dogfood',
      kind: 'coding',
      prompt: 'Fix the bug.',
      fixture: {
        type: 'git-worktree',
        ref: 'v0.0.37',
      },
    });

    expect(parsed.fixture).toEqual({
      type: 'git-worktree',
      repo: '.',
      ref: 'v0.0.37',
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
