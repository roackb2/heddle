import { describe, it, expect } from 'vitest';
import { createToolRegistry } from '../../core/tools/registry.js';
import { createBudget } from '../../core/utils/budget.js';
import { createTraceRecorder } from '../../core/trace/recorder.js';
import { isRepoReviewCommand } from '../../core/agent/mutation-tracking.js';
import type { ToolDefinition, TraceEvent } from '../../core/types.js';

describe('createToolRegistry', () => {
  const fakeTool: ToolDefinition = {
    name: 'test_tool',
    description: 'A test tool',
    parameters: { type: 'object', properties: {} },
    execute: async () => ({ ok: true, output: 'hello' }),
  };

  it('registers and retrieves a tool by name', () => {
    const registry = createToolRegistry([fakeTool]);
    expect(registry.get('test_tool')).toBe(fakeTool);
  });

  it('returns undefined for unknown tools', () => {
    const registry = createToolRegistry([fakeTool]);
    expect(registry.get('nonexistent')).toBeUndefined();
  });

  it('lists all tool names', () => {
    const another: ToolDefinition = { ...fakeTool, name: 'another' };
    const registry = createToolRegistry([fakeTool, another]);
    expect(registry.names()).toEqual(['test_tool', 'another']);
  });

  it('throws on duplicate tool names', () => {
    expect(() => createToolRegistry([fakeTool, fakeTool])).toThrow('Duplicate tool name');
  });
});

describe('createBudget', () => {
  it('counts steps and reports exhaustion', () => {
    const budget = createBudget(3);

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

describe('createTraceRecorder', () => {
  it('records events and exports them', () => {
    const recorder = createTraceRecorder();

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
    const recorder = createTraceRecorder();
    recorder.record({ type: 'run.started', goal: 'test', timestamp: '2024-01-01T00:00:00Z' });

    const json = recorder.toJSON();
    const parsed = JSON.parse(json);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].type).toBe('run.started');
  });

  it('returns a copy from getTrace so mutations do not affect the recorder', () => {
    const recorder = createTraceRecorder();
    recorder.record({ type: 'run.started', goal: 'test', timestamp: '2024-01-01T00:00:00Z' });

    const trace = recorder.getTrace();
    trace.pop();
    expect(recorder.getTrace()).toHaveLength(1);
  });
});

describe('isRepoReviewCommand', () => {
  it('only accepts the stricter git evidence commands', () => {
    expect(isRepoReviewCommand('git diff --stat')).toBe(true);
    expect(isRepoReviewCommand('git diff --stat=10')).toBe(true);
    expect(isRepoReviewCommand('git status --short')).toBe(true);
    expect(isRepoReviewCommand('git diff')).toBe(false);
    expect(isRepoReviewCommand('git status')).toBe(false);
    expect(isRepoReviewCommand('git status --long')).toBe(false);
  });
});
