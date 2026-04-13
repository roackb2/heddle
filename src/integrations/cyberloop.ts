import type { AgentLoopEvent } from '../runtime/events.js';

export type CyberLoopMetadataChannels = Record<string, unknown>;

export type CyberLoopStepContext<S = unknown> = {
  step: number;
  state: S;
  prevState?: S;
  budget: { used: number; remaining: number };
  metadata: CyberLoopMetadataChannels;
};

export type CyberLoopStepResult<S = unknown> = {
  state: S;
  action?: unknown;
  feedback?: unknown;
  cost?: number;
};

/**
 * Structural subset of CyberLoop's middleware contract.
 *
 * Heddle does not import CyberLoop directly. Callers can pass middleware from
 * CyberLoop because TypeScript's structural typing makes the contracts match.
 */
export type CyberLoopCompatibleMiddleware<S = unknown> = {
  name: string;
  setup?: (ctx: { input: unknown }) => Promise<void>;
  beforeStep?: (ctx: CyberLoopStepContext<S>) => Promise<CyberLoopStepContext<S> | 'halt'>;
  afterStep?: (ctx: CyberLoopStepContext<S>, result: CyberLoopStepResult<S>) => Promise<void>;
  teardown?: (ctx: { reason: string }) => Promise<void>;
};

/**
 * Structural subset of CyberLoop's StateEmbedder contract.
 */
export type CyberLoopCompatibleStateEmbedder<S = unknown> = {
  embed: (state: S) => Promise<number[]>;
};

export type HeddleRuntimeFrameKind =
  | 'assistant'
  | 'tool'
  | 'checkpoint'
  | 'heartbeat'
  | 'final';

export type HeddleRuntimeFrame = {
  runId: string;
  step: number;
  kind: HeddleRuntimeFrameKind;
  goal: string;
  text: string;
  timestamp: string;
  tool?: string;
  toolCallId?: string;
  ok?: boolean;
  rawEvent: AgentLoopEvent;
};

export type CyberLoopDriftLevel = 'unknown' | 'low' | 'medium' | 'high';

export type CyberLoopObserverAnnotation = {
  runId: string;
  step: number;
  frame: HeddleRuntimeFrame;
  metadata: CyberLoopMetadataChannels;
  driftLevel: CyberLoopDriftLevel;
  requestedHalt: boolean;
  timestamp: string;
};

export type CreateCyberLoopObserverOptions = {
  middleware: CyberLoopCompatibleMiddleware<HeddleRuntimeFrame>[];
  baselineFrame?: (event: Extract<AgentLoopEvent, { type: 'loop.started' }>) => HeddleRuntimeFrame | undefined;
  shouldObserveFrame?: (frame: HeddleRuntimeFrame) => boolean;
  onAnnotation?: (annotation: CyberLoopObserverAnnotation) => void;
  onError?: (error: unknown) => void;
};

export type RuntimeFrameEmbedText = (text: string, frame: HeddleRuntimeFrame) => Promise<number[]>;

export type CreateRuntimeFrameEmbedderOptions = {
  embedText: RuntimeFrameEmbedText;
  includeGoal?: boolean;
  maxTextLength?: number;
};

export type CyberLoopObserver = {
  handleEvent: (event: AgentLoopEvent) => void;
  flush: () => Promise<void>;
};

export function createRuntimeFrameEmbedder(
  options: CreateRuntimeFrameEmbedderOptions,
): CyberLoopCompatibleStateEmbedder<HeddleRuntimeFrame> {
  return {
    async embed(frame) {
      return options.embedText(formatRuntimeFrameForEmbedding(frame, options), frame);
    },
  };
}

export function formatRuntimeFrameForEmbedding(
  frame: HeddleRuntimeFrame,
  options: Pick<CreateRuntimeFrameEmbedderOptions, 'includeGoal' | 'maxTextLength'> = {},
): string {
  const maxTextLength = options.maxTextLength ?? 4_000;
  const sections = [
    `kind: ${frame.kind}`,
    frame.tool ? `tool: ${frame.tool}` : undefined,
    typeof frame.ok === 'boolean' ? `ok: ${frame.ok}` : undefined,
    options.includeGoal ? `goal: ${frame.goal}` : undefined,
    '',
    frame.text,
  ].filter((section): section is string => section !== undefined);

  return sections.join('\n').slice(0, maxTextLength);
}

export function createCyberLoopObserver(options: CreateCyberLoopObserverOptions): CyberLoopObserver {
  let queue = Promise.resolve();
  let runId: string | undefined;
  let goal = '';
  let initialized = false;
  let previousFrame: HeddleRuntimeFrame | undefined;
  let observedFrameKeys = new Set<string>();

  const enqueue = (work: () => Promise<void>) => {
    queue = queue.then(work, work).catch((error: unknown) => {
      options.onError?.(error);
    });
  };

  const setup = async (event: Extract<AgentLoopEvent, { type: 'loop.started' }>) => {
    runId = event.runId;
    goal = event.goal;
    previousFrame = undefined;
    observedFrameKeys = new Set();
    initialized = true;
    for (const middleware of options.middleware) {
      await middleware.setup?.({ input: event });
    }

    const baselineFrame = options.baselineFrame?.(event);
    if (baselineFrame) {
      await observeFrame(baselineFrame, { annotate: false });
    }
  };

  const teardown = async (reason: string) => {
    if (!initialized) {
      return;
    }
    for (const middleware of options.middleware) {
      await middleware.teardown?.({ reason });
    }
    initialized = false;
  };

  const observeFrame = async (frame: HeddleRuntimeFrame, observeOptions: { annotate?: boolean } = {}) => {
    if (!initialized) {
      initialized = true;
      runId = frame.runId;
      goal = frame.goal;
      for (const middleware of options.middleware) {
        await middleware.setup?.({ input: frame.rawEvent });
      }
    }

    if (options.shouldObserveFrame && !options.shouldObserveFrame(frame)) {
      return;
    }

    const frameKey = runtimeFrameKey(frame);
    if (observedFrameKeys.has(frameKey)) {
      return;
    }
    observedFrameKeys.add(frameKey);

    let ctx: CyberLoopStepContext<HeddleRuntimeFrame> = {
      step: frame.step,
      state: frame,
      prevState: previousFrame,
      budget: { used: frame.step, remaining: Number.POSITIVE_INFINITY },
      metadata: {},
    };

    let requestedHalt = false;
    for (const middleware of options.middleware) {
      const next = await middleware.beforeStep?.(ctx);
      if (next === 'halt') {
        requestedHalt = true;
        break;
      }
      if (next) {
        ctx = next;
      }
    }

    const result: CyberLoopStepResult<HeddleRuntimeFrame> = {
      state: frame,
      action: frame.kind,
      feedback: frame.ok,
      cost: 1,
    };

    for (let i = options.middleware.length - 1; i >= 0; i--) {
      await options.middleware[i]?.afterStep?.(ctx, result);
    }

    previousFrame = frame;
    if (observeOptions.annotate !== false) {
      options.onAnnotation?.({
        runId: frame.runId,
        step: frame.step,
        frame,
        metadata: ctx.metadata,
        driftLevel: inferDriftLevel(ctx.metadata),
        requestedHalt,
        timestamp: new Date().toISOString(),
      });
    }
  };

  return {
    handleEvent(event: AgentLoopEvent) {
      enqueue(async () => {
        if (event.type === 'loop.started') {
          await setup(event);
          return;
        }

        const frame = eventToRuntimeFrame(event, { runId, goal });
        if (frame) {
          await observeFrame(frame);
        }

        if (event.type === 'loop.finished') {
          await teardown(event.outcome);
        }
      });
    },
    flush() {
      return queue;
    },
  };
}

function runtimeFrameKey(frame: HeddleRuntimeFrame): string {
  return [
    frame.runId,
    frame.step,
    frame.kind,
    frame.tool ?? '',
    frame.ok === undefined ? '' : String(frame.ok),
    frame.text,
  ].join('\u001f');
}

export function eventToRuntimeFrame(
  event: AgentLoopEvent,
  context: { runId?: string; goal?: string } = {},
): HeddleRuntimeFrame | undefined {
  const runId = 'runId' in event ? event.runId : context.runId;
  if (!runId) {
    return undefined;
  }

  const goal = context.goal ?? (event.type === 'loop.started' ? event.goal : '');

  if (event.type === 'assistant.stream' && event.done) {
    return {
      runId,
      step: event.step,
      kind: 'assistant',
      goal,
      text: event.text,
      timestamp: event.timestamp,
      rawEvent: event,
    };
  }

  if (event.type === 'tool.completed') {
    return {
      runId,
      step: event.step,
      kind: 'tool',
      goal,
      text: formatToolCompletedText(event),
      timestamp: event.timestamp,
      tool: event.tool,
      toolCallId: event.toolCallId,
      ok: event.result.ok,
      rawEvent: event,
    };
  }

  if (event.type === 'trace' && event.event.type === 'assistant.turn') {
    return {
      runId,
      step: event.event.step,
      kind: 'assistant',
      goal,
      text: event.event.content,
      timestamp: event.timestamp,
      rawEvent: event,
    };
  }

  if (event.type === 'trace' && event.event.type === 'tool.result') {
    return {
      runId,
      step: event.event.step,
      kind: 'tool',
      goal,
      text: formatTraceToolResultText(event.event.tool, event.event.result),
      timestamp: event.timestamp,
      tool: event.event.tool,
      ok: event.event.result.ok,
      rawEvent: event,
    };
  }

  if (event.type === 'checkpoint.saved') {
    return {
      runId,
      step: event.step,
      kind: 'checkpoint',
      goal,
      text: `Checkpoint saved for ${event.checkpoint.runId}`,
      timestamp: event.timestamp,
      rawEvent: event,
    };
  }

  if (event.type === 'heartbeat.decision') {
    return {
      runId,
      step: 0,
      kind: 'heartbeat',
      goal,
      text: `Heartbeat decision: ${event.decision}. ${event.summary}`,
      timestamp: event.timestamp,
      ok: event.decision !== 'escalate',
      rawEvent: event,
    };
  }

  if (event.type === 'loop.finished') {
    return {
      runId,
      step: event.state.trace.length,
      kind: 'final',
      goal: event.state.goal,
      text: event.summary,
      timestamp: event.timestamp,
      ok: event.outcome === 'done',
      rawEvent: event,
    };
  }

  return undefined;
}

export function inferDriftLevel(metadata: CyberLoopMetadataChannels): CyberLoopDriftLevel {
  const manifold = metadata.manifold as { isDrifting?: unknown; normalDriftMagnitude?: unknown } | undefined;
  const grassmannian = metadata.grassmannian as { isDrifting?: unknown; geodesicDistance?: unknown } | undefined;
  const kinematics = metadata.kinematics as { isStable?: unknown; correctionMagnitude?: unknown; errorMagnitude?: unknown } | undefined;
  const hasCorrection = metadata.kinematicsCorrection != null;

  if (manifold?.isDrifting === true || grassmannian?.isDrifting === true) {
    return 'high';
  }

  if (kinematics?.isStable === false || hasCorrection) {
    return 'medium';
  }

  if (manifold || grassmannian || kinematics) {
    return 'low';
  }

  return 'unknown';
}

function formatToolCompletedText(event: Extract<AgentLoopEvent, { type: 'tool.completed' }>): string {
  if (!event.result.ok) {
    return `Tool ${event.tool} failed: ${event.result.error ?? 'unknown error'}`;
  }

  const output = event.result.output;
  if (typeof output === 'string') {
    return `Tool ${event.tool} completed: ${output.slice(0, 1_000)}`;
  }

  return `Tool ${event.tool} completed: ${JSON.stringify(output).slice(0, 1_000)}`;
}

function formatTraceToolResultText(tool: string, result: { ok: boolean; output?: unknown; error?: string }): string {
  if (!result.ok) {
    return `Tool ${tool} failed: ${result.error ?? 'unknown error'}`;
  }

  if (typeof result.output === 'string') {
    return `Tool ${tool} completed: ${result.output.slice(0, 1_000)}`;
  }

  return `Tool ${tool} completed: ${JSON.stringify(result.output).slice(0, 1_000)}`;
}
