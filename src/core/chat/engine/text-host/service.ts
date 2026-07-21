import { ToolActivitySummarizer } from '@/core/live/index.js';
import type { ConversationActivity, ConversationCompactionStatus } from '@/core/live/index.js';
import type { TraceEvent, ToolResult } from '@/core/types.js';
import type { ConversationEngineHost } from '../types.js';
import type { ConversationTurnResultSummary, ConversationTurnToolResult } from '../turn-result.js';
import type {
  ConversationTextHost,
  ConversationTextHostMode,
  ConversationTextHostOptions,
  ConversationTextHostWriter,
} from './types.js';

const DEFAULT_TEXT_HOST_OPTIONS = {
  activity: 'status',
  trace: 'off',
  compaction: 'status',
  result: 'status',
} satisfies Required<Omit<ConversationTextHostOptions, 'output'>>;

/**
 * Owns the default text rendering path for programmatic conversation hosts.
 */
export class ConversationTextHostService {
  private readonly writer: ConversationTextHostWriter;
  private readonly activityMode: ConversationTextHostMode;
  private readonly traceMode: ConversationTextHostMode;
  private readonly compactionMode: Exclude<ConversationTextHostMode, 'verbose'>;
  private readonly resultMode: Exclude<ConversationTextHostMode, 'verbose'>;
  private streamedAssistantText = '';
  private readonly streamedCommentaryText = new Map<string, string>();
  private streamedReasoningSummaryText = '';

  constructor(options: ConversationTextHostOptions = {}) {
    this.writer = ConversationTextHostService.normalizeWriter(options.output);
    this.activityMode = options.activity ?? DEFAULT_TEXT_HOST_OPTIONS.activity;
    this.traceMode = options.trace ?? DEFAULT_TEXT_HOST_OPTIONS.trace;
    this.compactionMode = options.compaction ?? DEFAULT_TEXT_HOST_OPTIONS.compaction;
    this.resultMode = options.result ?? DEFAULT_TEXT_HOST_OPTIONS.result;
  }

  create(): ConversationTextHost {
    const host: ConversationEngineHost = {
      events: {
        onActivity: (activity) => {
          this.writeActivity(activity);
        },
      },
      trace: {
        onEvent: (event) => {
          this.writeFormatted(this.formatTraceEvent(event));
        },
      },
      compaction: {
        onStatus: (event) => {
          this.writeFormatted(this.formatCompactionStatus(event));
        },
      },
    };

    return {
      host,
      renderTurnResult: (result) => {
        if (this.resultMode === 'off') {
          return;
        }

        this.writeFormatted(this.formatTurnResult(result));
      },
      formatActivity: (activity) => this.formatActivity(activity),
      formatTraceEvent: (event) => this.formatTraceEvent(event),
      formatCompactionStatus: (event) => this.formatCompactionStatus(event),
      formatTurnResult: (result) => this.formatTurnResult(result),
    };
  }

  formatActivity(activity: ConversationActivity): string | undefined {
    if (
      this.activityMode === 'off'
      || activity.type === 'assistant.stream'
      || activity.type === 'assistant.commentary'
      || activity.type === 'reasoning.summary'
    ) {
      return undefined;
    }

    if (this.activityMode === 'verbose') {
      return `[activity] ${activity.type} ${ConversationTextHostService.safeJson(activity)}`;
    }

    switch (activity.type) {
      case 'loop.started':
        return `[activity] started ${activity.model}`;
      case 'tool.calling':
        return `[activity] tool ${activity.derived?.kind === 'tool-summary' ? activity.derived.summary : activity.tool}`;
      case 'tool.completed':
        return `[activity] tool ${activity.tool}:${ConversationTextHostService.resultStatus(activity.result)}`;
      case 'tool.approval_requested':
        return `[activity] approval requested ${ToolActivitySummarizer.summarizeCall(activity.call)}`;
      case 'tool.approval_resolved':
        return `[activity] approval ${activity.approved ? 'approved' : 'denied'} ${activity.call.tool}`;
      case 'tool.fallback':
        return `[activity] tool fallback ${activity.fromCall.tool} -> ${activity.toCall.tool}`;
      case 'plan.updated':
        return `[activity] plan updated ${activity.items.length} item${activity.items.length === 1 ? '' : 's'}`;
      case 'loop.finished':
        return `[activity] finished ${activity.outcome}`;
      case 'compaction.running':
      case 'compaction.finished':
      case 'compaction.failed':
        return this.formatCompactionStatus(activity);
      case 'direct_shell.started':
        return `[activity] shell started ${activity.tool}`;
      case 'direct_shell.completed':
        return `[activity] shell completed ${activity.tool}:${ConversationTextHostService.resultStatus(activity.result)}`;
    }
  }

  formatTraceEvent(event: TraceEvent): string | undefined {
    if (this.traceMode === 'off') {
      return undefined;
    }

    return this.traceMode === 'verbose'
      ? `[trace] ${event.type} ${ConversationTextHostService.safeJson(event)}`
      : `[trace] ${event.type}`;
  }

  formatCompactionStatus(event: ConversationCompactionStatus): string | undefined {
    if (this.compactionMode === 'off') {
      return undefined;
    }

    switch (event.status) {
      case 'running':
        return event.archivePath ? `[compaction] running archive=${event.archivePath}` : '[compaction] running';
      case 'finished':
        return event.summaryPath ? `[compaction] finished summary=${event.summaryPath}` : '[compaction] finished';
      case 'failed':
        return event.error ? `[compaction] failed error=${event.error}` : '[compaction] failed';
    }
  }

  formatTurnResult(result: ConversationTurnResultSummary): string {
    return [
      '',
      'Turn result',
      '-----------',
      `Outcome: ${result.outcome}`,
      `Session: ${result.session.id}`,
      `Trace file: ${result.traceFile ?? 'unavailable'}`,
      `Artifacts: ${ConversationTextHostService.formatArtifacts(result)}`,
      `Tool calls: ${ConversationTextHostService.formatToolResults(result.toolResults)}`,
      `Summary: ${result.summary}`,
    ].join('\n');
  }

  private writeActivity(activity: ConversationActivity): void {
    if (activity.type === 'assistant.stream') {
      const nextText = activity.text.slice(this.streamedAssistantText.length);
      if (nextText) {
        this.writer.write(nextText);
      }
      this.streamedAssistantText = activity.text;
      return;
    }

    if (activity.type === 'assistant.commentary') {
      const previousText = this.streamedCommentaryText.get(activity.messageId) ?? '';
      const nextText = activity.text.slice(previousText.length);
      if (nextText) {
        this.writer.write(`${previousText ? '' : 'Working: '}${nextText}`);
      }
      this.streamedCommentaryText.set(activity.messageId, activity.text);
      if (activity.done) {
        this.writer.write('\n');
        this.streamedCommentaryText.delete(activity.messageId);
      }
      return;
    }

    if (activity.type === 'reasoning.summary') {
      const nextText = activity.text.slice(this.streamedReasoningSummaryText.length);
      if (nextText) {
        this.writer.write(`${this.streamedReasoningSummaryText ? '' : 'Thinking: '}${nextText}`);
      }
      this.streamedReasoningSummaryText = activity.text;
      if (activity.done) {
        this.writer.write('\n');
        this.streamedReasoningSummaryText = '';
      }
      return;
    }

    this.writeFormatted(this.formatActivity(activity));
  }

  private writeFormatted(text: string | undefined): void {
    if (!text) {
      return;
    }

    this.writer.write(`${text}\n`);
  }

  private static normalizeWriter(output: ConversationTextHostOptions['output']): ConversationTextHostWriter {
    if (!output) {
      return process.stdout;
    }

    return typeof output === 'function' ? { write: output } : output;
  }

  private static resultStatus(result: ToolResult): string {
    return result.ok ? 'ok' : result.error ?? 'error';
  }

  private static formatArtifacts(result: ConversationTurnResultSummary): string {
    return result.artifacts.length
      ? result.artifacts.map((artifact) => artifact.id).join(', ')
      : 'none';
  }

  private static formatToolResults(toolResults: ConversationTurnToolResult[]): string {
    return toolResults.length
      ? toolResults.map((entry) => `${entry.call.tool}:${ConversationTextHostService.resultStatus(entry.result)}`).join(', ')
      : 'none';
  }

  private static safeJson(value: unknown): string {
    try {
      return JSON.stringify(value);
    } catch {
      return '[unserializable]';
    }
  }
}

export function createConversationTextHost(options: ConversationTextHostOptions = {}): ConversationTextHost {
  return new ConversationTextHostService(options).create();
}
