import { describe, expect, it, vi } from 'vitest';
import {
  createCyberLoopObserver,
  eventToRuntimeFrame,
  inferDriftLevel,
  type CyberLoopCompatibleMiddleware,
  type CyberLoopObserverAnnotation,
  type HeddleRuntimeFrame,
} from '../integrations/cyberloop.js';
import type { AgentLoopEvent } from '../runtime/events.js';

describe('CyberLoop observer integration', () => {
  it('converts host-facing runtime events into Heddle runtime frames', () => {
    const frame = eventToRuntimeFrame({
      type: 'tool.completed',
      runId: 'run-1',
      step: 2,
      tool: 'read_file',
      toolCallId: 'call-1',
      result: { ok: true, output: 'file content' },
      durationMs: 12,
      timestamp: '2026-04-12T00:00:00.000Z',
    }, {
      goal: 'Inspect the repo',
    });

    expect(frame).toMatchObject({
      runId: 'run-1',
      step: 2,
      kind: 'tool',
      goal: 'Inspect the repo',
      tool: 'read_file',
      toolCallId: 'call-1',
      ok: true,
    });
    expect(frame?.text).toContain('Tool read_file completed');
  });

  it('runs CyberLoop-compatible middleware over observed frames without owning the Heddle loop', async () => {
    const annotations: CyberLoopObserverAnnotation[] = [];
    const calls: string[] = [];
    const middleware: CyberLoopCompatibleMiddleware<HeddleRuntimeFrame> = {
      name: 'fake-drift',
      async setup() {
        calls.push('setup');
      },
      async beforeStep(ctx) {
        calls.push(`before:${ctx.state.kind}:${ctx.step}`);
        return {
          ...ctx,
          metadata: {
            ...ctx.metadata,
            kinematics: { isStable: false, correctionMagnitude: 0.5 },
          },
        };
      },
      async afterStep(ctx, result) {
        calls.push(`after:${ctx.state.kind}:${result.action}`);
      },
      async teardown() {
        calls.push('teardown');
      },
    };

    const observer = createCyberLoopObserver({
      middleware: [middleware],
      onAnnotation: (annotation) => annotations.push(annotation),
    });

    for (const event of createEventSequence()) {
      observer.handleEvent(event);
    }
    await observer.flush();

    expect(calls).toEqual([
      'setup',
      'before:assistant:1',
      'after:assistant:assistant',
      'before:tool:1',
      'after:tool:tool',
      'before:final:3',
      'after:final:final',
      'teardown',
    ]);
    expect(annotations).toHaveLength(3);
    expect(annotations.map((annotation) => annotation.driftLevel)).toEqual(['medium', 'medium', 'medium']);
    expect(annotations[1]?.frame.kind).toBe('tool');
  });

  it('records requested halts as annotations instead of stopping Heddle execution', async () => {
    const annotations: CyberLoopObserverAnnotation[] = [];
    const middleware: CyberLoopCompatibleMiddleware<HeddleRuntimeFrame> = {
      name: 'halt-request',
      async beforeStep() {
        return 'halt';
      },
    };

    const observer = createCyberLoopObserver({
      middleware: [middleware],
      onAnnotation: (annotation) => annotations.push(annotation),
    });

    observer.handleEvent(createLoopStarted());
    observer.handleEvent({
      type: 'assistant.stream',
      runId: 'run-1',
      step: 1,
      text: 'I am drifting.',
      done: true,
      timestamp: '2026-04-12T00:00:01.000Z',
    });
    await observer.flush();

    expect(annotations).toHaveLength(1);
    expect(annotations[0]?.requestedHalt).toBe(true);
  });

  it('routes async middleware failures through onError without breaking later events', async () => {
    const errors: unknown[] = [];
    const annotations: CyberLoopObserverAnnotation[] = [];
    let calls = 0;
    const middleware: CyberLoopCompatibleMiddleware<HeddleRuntimeFrame> = {
      name: 'flaky',
      async beforeStep(ctx) {
        calls++;
        if (calls === 1) {
          throw new Error('embedder failed');
        }
        return ctx;
      },
    };

    const observer = createCyberLoopObserver({
      middleware: [middleware],
      onAnnotation: (annotation) => annotations.push(annotation),
      onError: (error) => errors.push(error),
    });

    observer.handleEvent(createLoopStarted());
    observer.handleEvent({
      type: 'assistant.stream',
      runId: 'run-1',
      step: 1,
      text: 'first',
      done: true,
      timestamp: '2026-04-12T00:00:01.000Z',
    });
    observer.handleEvent({
      type: 'assistant.stream',
      runId: 'run-1',
      step: 2,
      text: 'second',
      done: true,
      timestamp: '2026-04-12T00:00:02.000Z',
    });
    await observer.flush();

    expect(errors).toHaveLength(1);
    expect(annotations).toHaveLength(1);
    expect(annotations[0]?.frame.text).toBe('second');
  });

  it('infers drift levels from CyberLoop metadata channels', () => {
    expect(inferDriftLevel({})).toBe('unknown');
    expect(inferDriftLevel({ kinematics: { isStable: true } })).toBe('low');
    expect(inferDriftLevel({ kinematics: { isStable: false } })).toBe('medium');
    expect(inferDriftLevel({ manifold: { isDrifting: true } })).toBe('high');
    expect(inferDriftLevel({ grassmannian: { isDrifting: true } })).toBe('high');
  });
});

function createEventSequence(): AgentLoopEvent[] {
  return [
    createLoopStarted(),
    {
      type: 'assistant.stream',
      runId: 'run-1',
      step: 1,
      text: 'I will inspect.',
      done: true,
      timestamp: '2026-04-12T00:00:01.000Z',
    },
    {
      type: 'tool.completed',
      runId: 'run-1',
      step: 1,
      tool: 'read_file',
      toolCallId: 'call-1',
      result: { ok: true, output: 'content' },
      durationMs: 10,
      timestamp: '2026-04-12T00:00:02.000Z',
    },
    {
      type: 'loop.finished',
      runId: 'run-1',
      outcome: 'done',
      summary: 'Done.',
      usage: undefined,
      timestamp: '2026-04-12T00:00:03.000Z',
      state: {
        status: 'finished',
        runId: 'run-1',
        goal: 'Inspect the repo',
        model: 'gpt-test',
        provider: 'openai',
        workspaceRoot: '/tmp/project',
        startedAt: '2026-04-12T00:00:00.000Z',
        finishedAt: '2026-04-12T00:00:03.000Z',
        outcome: 'done',
        summary: 'Done.',
        transcript: [],
        trace: [
          { type: 'run.started', goal: 'Inspect the repo', timestamp: '2026-04-12T00:00:00.000Z' },
          {
            type: 'assistant.turn',
            content: 'I will inspect.',
            requestedTools: false,
            step: 1,
            timestamp: '2026-04-12T00:00:01.000Z',
          },
          {
            type: 'run.finished',
            outcome: 'done',
            summary: 'Done.',
            step: 3,
            timestamp: '2026-04-12T00:00:03.000Z',
          },
        ],
      },
    },
  ];
}

function createLoopStarted(): AgentLoopEvent {
  return {
    type: 'loop.started',
    runId: 'run-1',
    goal: 'Inspect the repo',
    model: 'gpt-test',
    provider: 'openai',
    workspaceRoot: '/tmp/project',
    timestamp: '2026-04-12T00:00:00.000Z',
  };
}
