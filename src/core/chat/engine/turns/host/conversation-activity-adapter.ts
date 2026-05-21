import type { AgentLoopEvent } from '@/core/runtime/loop/index.js';
import type { TraceEvent } from '@/core/types.js';
import type {
  ConversationAgentLoopActivityEvent,
  ConversationActivity,
  ConversationActivityCorrelation,
  ConversationActivityDerived,
  ConversationCompactionStatus,
} from '@/core/chat/engine/live/types.js';
import { ToolActivitySummarizer } from '@/core/chat/engine/live/tool-activity-summarizer.js';

type TraceActivityAdapterMap = {
  [Type in TraceEvent['type']]: (event: Extract<TraceEvent, { type: Type }>) => ConversationActivity[];
};

type AgentLoopActivityAdapterMap = {
  [Type in AgentLoopEvent['type']]?: (event: Extract<AgentLoopEvent, { type: Type }>) => ConversationActivity[];
};

type CompactionActivityAdapterMap = {
  [Status in ConversationCompactionStatus['status']]: (event: Extract<ConversationCompactionStatus, { status: Status }>) => ConversationActivity[];
};

/**
 * Converts lower-level runtime, trace, and compaction events at the chat-engine
 * host boundary. Above this boundary, hosts and interfaces should consume
 * `ConversationActivity` directly through `events.onActivity`.
 */
export class ConversationEngineActivityAdapter {
  private static readonly traceAdapters: TraceActivityAdapterMap = {
    'run.started': (event) => [ConversationEngineActivityAdapter.traceActivity(event)],
    'assistant.turn': (event) => [ConversationEngineActivityAdapter.traceActivity(event)],
    'host.warning': () => [],
    'tool.approval_requested': (event) => [ConversationEngineActivityAdapter.traceActivity(event, {
      kind: 'tool-summary',
      summary: ToolActivitySummarizer.summarizeCall(event.call),
    })],
    'tool.approval_resolved': (event) => [ConversationEngineActivityAdapter.traceActivity(event, {
      kind: 'tool-summary',
      summary: ToolActivitySummarizer.summarizeCall(event.call),
    })],
    'tool.fallback': (event) => [ConversationEngineActivityAdapter.traceActivity(event, {
      kind: 'tool-fallback-summary',
      fromSummary: ToolActivitySummarizer.summarizeCall(event.fromCall),
      toSummary: ToolActivitySummarizer.summarizeCall(event.toCall),
    })],
    'tool.call': (event) => [ConversationEngineActivityAdapter.traceActivity(event, {
      kind: 'tool-summary',
      summary: ToolActivitySummarizer.summarizeCall(event.call),
    })],
    'tool.result': (event) => [ConversationEngineActivityAdapter.traceActivity(event, {
      kind: 'tool-summary',
      summary: ToolActivitySummarizer.summarizeResult(event),
    })],
    'memory.candidate_recorded': (event) => [ConversationEngineActivityAdapter.traceActivity(event)],
    'memory.checkpoint_skipped': () => [],
    'memory.maintenance_started': (event) => [ConversationEngineActivityAdapter.traceActivity(event)],
    'memory.maintenance_finished': (event) => [ConversationEngineActivityAdapter.traceActivity(event)],
    'memory.maintenance_failed': (event) => [ConversationEngineActivityAdapter.traceActivity(event)],
    'cyberloop.annotation': (event) => (
      event.driftLevel === 'unknown' ? [] : [ConversationEngineActivityAdapter.traceActivity(event, {
        kind: 'cyberloop-metrics',
        metrics: ConversationEngineActivityAdapter.formatCyberLoopMetrics(event.metadata),
      })]
    ),
    'run.finished': (event) => [ConversationEngineActivityAdapter.traceActivity(event)],
  };

  private static readonly agentLoopAdapters: AgentLoopActivityAdapterMap = {
    'loop.started': (event) => [ConversationEngineActivityAdapter.agentLoopActivity(event)],
    'assistant.stream': (event) => [ConversationEngineActivityAdapter.agentLoopActivity(event)],
    'tool.calling': (event) => [ConversationEngineActivityAdapter.agentLoopActivity(event, {
      kind: 'tool-summary',
      summary: ToolActivitySummarizer.summarizeCall(event),
    })],
    'tool.completed': (event) => [ConversationEngineActivityAdapter.agentLoopActivity(event)],
    trace: (event) => ConversationEngineActivityAdapter.fromTraceEvent(event.event)
      .map((activity) => activity.source === 'trace' ? {
        ...activity,
        correlation: { ...activity.correlation, runId: event.runId },
      } : activity),
    'loop.finished': (event) => [ConversationEngineActivityAdapter.agentLoopActivity(event)],
  };

  private static readonly compactionAdapters: CompactionActivityAdapterMap = {
    running: (event) => [{ source: 'compaction', type: 'compaction.running', event }],
    finished: (event) => [{ source: 'compaction', type: 'compaction.finished', event }],
    failed: (event) => [{ source: 'compaction', type: 'compaction.failed', event }],
  };

  static fromTraceEvent(event: TraceEvent): ConversationActivity[] {
    const adapter = ConversationEngineActivityAdapter.traceAdapters[event.type] as (event: TraceEvent) => ConversationActivity[];
    return adapter(event);
  }

  static fromAgentLoopEvent(event: AgentLoopEvent): ConversationActivity[] {
    const adapter = ConversationEngineActivityAdapter.agentLoopAdapters[event.type] as ((event: AgentLoopEvent) => ConversationActivity[]) | undefined;
    return adapter?.(event) ?? [];
  }

  static fromCompactionStatus(event: ConversationCompactionStatus): ConversationActivity[] {
    const adapter = ConversationEngineActivityAdapter.compactionAdapters[event.status] as (event: ConversationCompactionStatus) => ConversationActivity[];
    return adapter(event);
  }

  private static traceActivity<Type extends TraceEvent['type']>(
    event: Extract<TraceEvent, { type: Type }>,
    derived?: ConversationActivityDerived,
  ): ConversationActivity {
    return {
      source: 'trace',
      type: event.type,
      event,
      correlation: ConversationEngineActivityAdapter.traceCorrelation(event),
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
      correlation: ConversationEngineActivityAdapter.agentLoopCorrelation(event),
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
      parts.push(`err=${ConversationEngineActivityAdapter.formatMetric(snapshot.errorMagnitude)}`);
    }
    if (typeof snapshot.correctionMagnitude === 'number') {
      parts.push(`corr=${ConversationEngineActivityAdapter.formatMetric(snapshot.correctionMagnitude)}`);
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
