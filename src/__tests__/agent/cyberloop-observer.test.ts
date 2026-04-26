import { describe, expect, it } from 'vitest';
import {
  createCyberLoopObserver,
  createRuntimeFrameEmbedder,
  eventToRuntimeFrame,
  formatRuntimeFrameForEmbedding,
  inferDriftLevel,
  type CyberLoopCompatibleMiddleware,
  type CyberLoopObserverAnnotation,
  type HeddleRuntimeFrame,
} from '../../integrations/cyberloop.js';
import { createCyberLoopKinematicsObserver } from '../../integrations/cyberloop-kinematics.js';
import type { AgentLoopEvent } from '../../core/runtime/events.js';

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

  it('deduplicates equivalent stream and trace frames for the same assistant turn', async () => {
    const annotations: CyberLoopObserverAnnotation[] = [];
    const calls: string[] = [];
    const middleware: CyberLoopCompatibleMiddleware<HeddleRuntimeFrame> = {
      name: 'count-frames',
      async beforeStep(ctx) {
        calls.push(`${ctx.state.kind}:${ctx.step}:${ctx.state.text}`);
        return {
          ...ctx,
          metadata: {
            ...ctx.metadata,
            kinematics: { isStable: true },
          },
        };
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
      text: 'Same answer.',
      done: true,
      timestamp: '2026-04-12T00:00:01.000Z',
    });
    observer.handleEvent({
      type: 'trace',
      runId: 'run-1',
      timestamp: '2026-04-12T00:00:01.100Z',
      event: {
        type: 'assistant.turn',
        content: 'Same answer.',
        requestedTools: false,
        step: 1,
        timestamp: '2026-04-12T00:00:01.000Z',
      },
    });
    await observer.flush();

    expect(calls).toEqual(['assistant:1:Same answer.']);
    expect(annotations).toHaveLength(1);
  });

  it('can seed trajectory with an unannotated baseline frame before observing current output', async () => {
    const annotations: CyberLoopObserverAnnotation[] = [];
    const previousStates: Array<string | undefined> = [];
    const observed: string[] = [];
    const middleware: CyberLoopCompatibleMiddleware<HeddleRuntimeFrame> = {
      name: 'trajectory',
      async beforeStep(ctx) {
        observed.push(ctx.state.text);
        previousStates.push(ctx.prevState?.text);
        return {
          ...ctx,
          metadata: {
            ...ctx.metadata,
            kinematics: { isStable: true },
          },
        };
      },
    };

    const observer = createCyberLoopObserver({
      middleware: [middleware],
      baselineFrame: (event) => ({
        runId: event.runId,
        step: 0,
        kind: 'assistant',
        goal: event.goal,
        text: 'Previous assistant response about Lucid integration.',
        timestamp: event.timestamp,
        rawEvent: event,
      }),
      shouldObserveFrame: (frame) => frame.kind === 'assistant' || frame.kind === 'final',
      onAnnotation: (annotation) => annotations.push(annotation),
    });

    observer.handleEvent(createLoopStarted());
    observer.handleEvent({
      type: 'tool.completed',
      runId: 'run-1',
      step: 1,
      tool: 'read_file',
      toolCallId: 'call-1',
      result: { ok: true, output: 'content' },
      durationMs: 10,
      timestamp: '2026-04-12T00:00:01.000Z',
    });
    observer.handleEvent({
      type: 'assistant.stream',
      runId: 'run-1',
      step: 2,
      text: 'Current assistant response about weather.',
      done: true,
      timestamp: '2026-04-12T00:00:02.000Z',
    });
    await observer.flush();

    expect(observed).toEqual([
      'Previous assistant response about Lucid integration.',
      'Current assistant response about weather.',
    ]);
    expect(previousStates).toEqual([
      undefined,
      'Previous assistant response about Lucid integration.',
    ]);
    expect(annotations).toHaveLength(1);
    expect(annotations[0]?.frame.text).toBe('Current assistant response about weather.');
  });

  it('uses a more sensitive default stability threshold for Heddle chat kinematics', async () => {
    const captured: unknown[] = [];
    const observer = await createCyberLoopKinematicsObserver({
      goal: 'current prompt',
      referenceText: 'previous assistant response',
      apiKey: 'test-key',
      moduleSpecifier: 'fake-module',
      onError: () => undefined,
      _testOverrides: {
        embedText: async (text) => text.includes('current') ? [0.06, 0] : [0, 0],
        advancedModule: {
          kinematicsMiddleware(options) {
            captured.push(options.pid);
            return {
              name: 'fake-kinematics',
              async beforeStep(ctx) {
                return {
                  ...ctx,
                  metadata: {
                    ...ctx.metadata,
                    kinematics: { isStable: true },
                  },
                };
              },
            };
          },
        },
      },
    });

    observer.observer.handleEvent(createLoopStarted());
    await observer.observer.flush();

    expect(captured).toEqual([{ stabilityThreshold: 0.05 }]);
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

  it('converts trace assistant turns into runtime frames for non-streaming adapters', () => {
    const frame = eventToRuntimeFrame({
      type: 'trace',
      runId: 'run-1',
      timestamp: '2026-04-12T00:00:01.000Z',
      event: {
        type: 'assistant.turn',
        content: 'Inspect README and summarize repository architecture.',
        requestedTools: false,
        step: 1,
        timestamp: '2026-04-12T00:00:01.000Z',
      },
    }, {
      goal: 'Inspect the repo',
    });

    expect(frame).toMatchObject({
      runId: 'run-1',
      step: 1,
      kind: 'assistant',
      goal: 'Inspect the repo',
      text: 'Inspect README and summarize repository architecture.',
    });
  });

  it('formats and embeds runtime frames through a caller-provided embedding function', async () => {
    const frame: HeddleRuntimeFrame = {
      runId: 'run-1',
      step: 2,
      kind: 'tool',
      goal: 'Inspect the repo',
      text: 'README says this is a terminal coding agent runtime.',
      timestamp: '2026-04-12T00:00:02.000Z',
      tool: 'read_file',
      ok: true,
      rawEvent: createLoopStarted(),
    };
    const seen: string[] = [];
    const embedder = createRuntimeFrameEmbedder({
      maxTextLength: 200,
      embedText: async (text) => {
        seen.push(text);
        return [1, 0, 0];
      },
    });

    await expect(embedder.embed(frame)).resolves.toEqual([1, 0, 0]);
    expect(seen[0]).toContain('kind: tool');
    expect(seen[0]).toContain('tool: read_file');
    expect(seen[0]).toContain('ok: true');
    expect(seen[0]).not.toContain('goal: Inspect the repo');
  });

  it('can include the run goal in frame embeddings when the caller explicitly opts in', () => {
    const frame: HeddleRuntimeFrame = {
      runId: 'run-1',
      step: 1,
      kind: 'assistant',
      goal: 'Inspect the repo',
      text: 'I will inspect the project files.',
      timestamp: '2026-04-12T00:00:01.000Z',
      rawEvent: createLoopStarted(),
    };

    expect(formatRuntimeFrameForEmbedding(frame, { includeGoal: true })).toContain('goal: Inspect the repo');
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
