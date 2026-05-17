import type { AgentLoopEvent } from '@/core/runtime/loop/index.js';
import type { TraceEvent } from '@/core/types.js';
import type {
  ApplyConversationActivityHandlerArgs,
  ConversationAgentLoopActivityEvent,
  ConversationActivity,
  ConversationActivityCorrelation,
  ConversationActivityDerived,
  ConversationCompactionStatus,
} from './types.js';
import { ToolActivitySummarizer } from './tool-activity-summarizer.js';

type TraceProjectorMap = {
  [Type in TraceEvent['type']]: (event: Extract<TraceEvent, { type: Type }>) => ConversationActivity[];
};

type AgentLoopProjectorMap = {
  [Type in AgentLoopEvent['type']]?: (event: Extract<AgentLoopEvent, { type: Type }>) => ConversationActivity[];
};

type CompactionProjectorMap = {
  [Status in ConversationCompactionStatus['status']]: (event: Extract<ConversationCompactionStatus, { status: Status }>) => ConversationActivity[];
};

/**
 * Projects raw runtime, trace, and compaction events into host-agnostic
 * conversation activities. Activities retain their source event and only add
 * derived fields when this boundary performs real semantic work.
 */
export class ConversationActivityProjector {
  private static readonly traceProjectors: TraceProjectorMap = {
    'run.started': (event) => [ConversationActivityProjector.traceActivity(event)],
    'assistant.turn': (event) => [ConversationActivityProjector.traceActivity(event)],
    'host.warning': () => [],
    'tool.approval_requested': (event) => [ConversationActivityProjector.traceActivity(event, {
      kind: 'tool-summary',
      summary: ToolActivitySummarizer.summarizeCall(event.call),
    })],
    'tool.approval_resolved': (event) => [ConversationActivityProjector.traceActivity(event, {
      kind: 'tool-summary',
      summary: ToolActivitySummarizer.summarizeCall(event.call),
    })],
    'tool.fallback': (event) => [ConversationActivityProjector.traceActivity(event, {
      kind: 'tool-fallback-summary',
      fromSummary: ToolActivitySummarizer.summarizeCall(event.fromCall),
      toSummary: ToolActivitySummarizer.summarizeCall(event.toCall),
    })],
    'tool.call': (event) => [ConversationActivityProjector.traceActivity(event, {
      kind: 'tool-summary',
      summary: ToolActivitySummarizer.summarizeCall(event.call),
    })],
    'tool.result': (event) => [ConversationActivityProjector.traceActivity(event, {
      kind: 'tool-summary',
      summary: ToolActivitySummarizer.summarizeResult(event),
    })],
    'memory.candidate_recorded': (event) => [ConversationActivityProjector.traceActivity(event)],
    'memory.checkpoint_skipped': () => [],
    'memory.maintenance_started': (event) => [ConversationActivityProjector.traceActivity(event)],
    'memory.maintenance_finished': (event) => [ConversationActivityProjector.traceActivity(event)],
    'memory.maintenance_failed': (event) => [ConversationActivityProjector.traceActivity(event)],
    'cyberloop.annotation': (event) => (
      event.driftLevel === 'unknown' ? [] : [ConversationActivityProjector.traceActivity(event, {
        kind: 'cyberloop-metrics',
        metrics: ConversationActivityProjector.formatCyberLoopMetrics(event.metadata),
      })]
    ),
    'run.finished': (event) => [ConversationActivityProjector.traceActivity(event)],
  };

  private static readonly agentLoopProjectors: AgentLoopProjectorMap = {
    'loop.started': (event) => [ConversationActivityProjector.agentLoopActivity(event)],
    'assistant.stream': (event) => [ConversationActivityProjector.agentLoopActivity(event)],
    'tool.calling': (event) => [ConversationActivityProjector.agentLoopActivity(event, {
      kind: 'tool-summary',
      summary: ToolActivitySummarizer.summarizeCall(event),
    })],
    'tool.completed': (event) => [ConversationActivityProjector.agentLoopActivity(event)],
    trace: (event) => ConversationActivityProjector.fromTraceEvent(event.event)
      .map((activity) => activity.source === 'trace' ? {
        ...activity,
        correlation: { ...activity.correlation, runId: event.runId },
      } : activity),
    'loop.finished': (event) => [ConversationActivityProjector.agentLoopActivity(event)],
  };

  private static readonly compactionProjectors: CompactionProjectorMap = {
    running: (event) => [{ source: 'compaction', type: 'compaction.running', event }],
    finished: (event) => [{ source: 'compaction', type: 'compaction.finished', event }],
    failed: (event) => [{ source: 'compaction', type: 'compaction.failed', event }],
  };

  static fromTraceEvent(event: TraceEvent): ConversationActivity[] {
    const projector = ConversationActivityProjector.traceProjectors[event.type] as (event: TraceEvent) => ConversationActivity[];
    return projector(event);
  }

  static fromAgentLoopEvent(event: AgentLoopEvent): ConversationActivity[] {
    const projector = ConversationActivityProjector.agentLoopProjectors[event.type] as ((event: AgentLoopEvent) => ConversationActivity[]) | undefined;
    return projector?.(event) ?? [];
  }

  static fromCompactionStatus(event: ConversationCompactionStatus): ConversationActivity[] {
    const projector = ConversationActivityProjector.compactionProjectors[event.status] as (event: ConversationCompactionStatus) => ConversationActivity[];
    return projector(event);
  }

  static applyHandler<Context, Result = void>(
    args: ApplyConversationActivityHandlerArgs<Context, Result>,
  ): Result | undefined {
    const handler = args.handlers[args.activity.type] as ((activity: ConversationActivity, context: Context) => Result) | undefined;
    return handler?.(args.activity, args.context);
  }

  private static traceActivity<Type extends TraceEvent['type']>(
    event: Extract<TraceEvent, { type: Type }>,
    derived?: ConversationActivityDerived,
  ): ConversationActivity {
    return {
      source: 'trace',
      type: event.type,
      event,
      correlation: ConversationActivityProjector.traceCorrelation(event),
      derived,
    } as ConversationActivity;
  }

  private static agentLoopActivity<Type extends ConversationAgentLoopActivityEvent['type']>(
    event: Extract<ConversationAgentLoopActivityEvent, { type: Type }>,
    derived?: ConversationActivityDerived,
  ): ConversationActivity {
    return {
      source: 'agent-loop',
      type: event.type,
      event,
      correlation: ConversationActivityProjector.agentLoopCorrelation(event),
      derived,
    } as ConversationActivity;
  }

  private static traceCorrelation(event: TraceEvent): ConversationActivityCorrelation {
    const correlation: ConversationActivityCorrelation = { timestamp: event.timestamp };
    if ('runId' in event) {
      correlation.runId = event.runId;
    }
    if ('step' in event) {
      correlation.step = event.step;
    }
    return correlation;
  }

  private static agentLoopCorrelation(event: AgentLoopEvent): ConversationActivityCorrelation {
    const correlation: ConversationActivityCorrelation = {
      runId: event.runId,
      timestamp: event.timestamp,
    };
    if ('step' in event) {
      correlation.step = event.step;
    }
    return correlation;
  }

  private static formatCyberLoopMetrics(metadata: Record<string, unknown>): string {
    const kinematics = metadata.kinematics;
    if (!kinematics || typeof kinematics !== 'object' || Array.isArray(kinematics)) {
      return '';
    }

    const snapshot = kinematics as {
      errorMagnitude?: unknown;
      correctionMagnitude?: unknown;
      isStable?: unknown;
    };
    const parts: string[] = [];
    if (typeof snapshot.errorMagnitude === 'number') {
      parts.push(`err=${ConversationActivityProjector.formatMetric(snapshot.errorMagnitude)}`);
    }
    if (typeof snapshot.correctionMagnitude === 'number') {
      parts.push(`corr=${ConversationActivityProjector.formatMetric(snapshot.correctionMagnitude)}`);
    }
    if (typeof snapshot.isStable === 'boolean') {
      parts.push(`stable=${snapshot.isStable}`);
    }

    return parts.length ? ` (${parts.join(' ')})` : '';
  }

  private static formatMetric(value: number): string {
    if (!Number.isFinite(value)) {
      return String(value);
    }
    if (Math.abs(value) < 0.001 && value !== 0) {
      return value.toExponential(2);
    }
    return value.toFixed(3);
  }
}
