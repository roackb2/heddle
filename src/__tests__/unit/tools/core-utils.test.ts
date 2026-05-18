import { describe, it, expect } from 'vitest';
import { ToolRegistry } from '@/core/tools/index.js';
import { AgentStepBudget } from '@/core/agent/budget/index.js';
import { TraceRecorder } from '@/core/trace/index.js';
import { AgentMutationTracker } from '../../../core/agent/mutation/index.js';
import type { ToolDefinition, TraceEvent } from '../../../core/types.js';

describe('ToolRegistry', () => {
  const fakeTool: ToolDefinition = {
    name: 'test_tool',
    description: 'A test tool',
    parameters: { type: 'object', properties: {} },
    execute: async () => ({ ok: true, output: 'hello' }),
  };

  it('registers and retrieves a tool by name', () => {
    const registry = new ToolRegistry([fakeTool]);
    expect(registry.get('test_tool')).toBe(fakeTool);
  });

  it('returns undefined for unknown tools', () => {
    const registry = new ToolRegistry([fakeTool]);
    expect(registry.get('nonexistent')).toBeUndefined();
  });

  it('lists all tool names', () => {
    const another: ToolDefinition = { ...fakeTool, name: 'another' };
    const registry = new ToolRegistry([fakeTool, another]);
    expect(registry.names()).toEqual(['test_tool', 'another']);
  });

  it('throws on duplicate tool names', () => {
    expect(() => new ToolRegistry([fakeTool, fakeTool])).toThrow('Duplicate tool name');
  });
});

describe('AgentStepBudget', () => {
  it('counts steps and reports exhaustion', () => {
    const budget = new AgentStepBudget(3);

    expect(budget.remaining()).toBe(3);
    expect(budget.exhausted()).toBe(false);

    budget.step();
    expect(budget.remaining()).toBe(2);

    budget.step();
    budget.step();
    expect(budget.remaining()).toBe(0);
    expect(budget.exhausted()).toBe(true);
  });
});

describe('TraceRecorder', () => {
  it('records events and exports them', () => {
    const recorder = new TraceRecorder();

    const event1: TraceEvent = { type: 'run.started', goal: 'test', timestamp: '2024-01-01T00:00:00Z' };
    const event2: TraceEvent = {
      type: 'run.finished',
      outcome: 'done',
      summary: 'all good',
      step: 1,
      timestamp: '2024-01-01T00:00:01Z',
    };

    recorder.record(event1);
    recorder.record(event2);

    const trace = recorder.getTrace();
    expect(trace).toHaveLength(2);
    expect(trace[0]).toEqual(event1);
    expect(trace[1]).toEqual(event2);
  });

  it('exports valid JSON', () => {
    const recorder = new TraceRecorder();
    recorder.record({ type: 'run.started', goal: 'test', timestamp: '2024-01-01T00:00:00Z' });

    const json = recorder.toJSON();
    const parsed = JSON.parse(json);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].type).toBe('run.started');
  });

  it('returns a copy from getTrace so mutations do not affect the recorder', () => {
    const recorder = new TraceRecorder();
    recorder.record({ type: 'run.started', goal: 'test', timestamp: '2024-01-01T00:00:00Z' });

    const trace = recorder.getTrace();
    trace.pop();
    expect(recorder.getTrace()).toHaveLength(1);
  });
});

describe('isRepoReviewCommand', () => {
  it('only accepts the stricter git evidence commands', () => {
    expect(AgentMutationTracker.isRepoReviewCommand('git diff --stat')).toBe(true);
    expect(AgentMutationTracker.isRepoReviewCommand('git diff --stat=10')).toBe(true);
    expect(AgentMutationTracker.isRepoReviewCommand('git status --short')).toBe(true);
    expect(AgentMutationTracker.isRepoReviewCommand('git diff')).toBe(false);
    expect(AgentMutationTracker.isRepoReviewCommand('git status')).toBe(false);
    expect(AgentMutationTracker.isRepoReviewCommand('git status --long')).toBe(false);
  });
});
