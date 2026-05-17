import { truncate } from '@/core/utils/text.js';
import type { ToolCallSummaryInput, ToolResultSummaryOptions, ToolSummaryOptions } from './types.js';

const DEFAULT_MAX_TOOL_SUMMARY_CHARS = 96;

/**
 * Builds compact tool call/result labels for live activity and durable trace
 * summaries. It owns presentation-safe summarization, not tool execution.
 */
export class ToolActivitySummarizer {
  static summarizeCall(call: ToolCallSummaryInput, options: ToolSummaryOptions = {}): string {
    const maxChars = options.maxChars ?? DEFAULT_MAX_TOOL_SUMMARY_CHARS;
    if (call.tool === 'update_plan') {
      return ToolActivitySummarizer.summarizePlanInput(call.tool, call.input, maxChars);
    }

    const command = ToolActivitySummarizer.readStringField(call.input, 'command');
    if (command) {
      return `${call.tool} (${truncate(command, maxChars)})`;
    }

    if (call.tool === 'search_files') {
      return ToolActivitySummarizer.summarizeSearchInput(call.tool, call.input, maxChars);
    }

    const moveSummary = ToolActivitySummarizer.summarizeMoveInput(call.tool, call.input, maxChars);
    if (moveSummary) {
      return moveSummary;
    }

    const path = ToolActivitySummarizer.readStringField(call.input, 'path');
    return path ? `${call.tool} (${truncate(path, maxChars)})` : call.tool;
  }

  static summarizeResult(options: ToolResultSummaryOptions): string {
    const maxChars = options.maxChars ?? DEFAULT_MAX_TOOL_SUMMARY_CHARS;
    const command = ToolActivitySummarizer.readStringField(options.result.output, 'command');
    if (command) {
      return `${options.tool} (${truncate(command, maxChars)})`;
    }

    const moveSummary = ToolActivitySummarizer.summarizeMoveInput(options.tool, options.result.output, maxChars);
    if (moveSummary) {
      return moveSummary;
    }

    const outputPath = ToolActivitySummarizer.readStringField(options.result.output, 'path');
    if (outputPath) {
      return `${options.tool} (${truncate(outputPath, maxChars)})`;
    }

    return options.tool;
  }

  private static summarizeMoveInput(tool: string, input: unknown, maxChars: number): string | undefined {
    const from = ToolActivitySummarizer.readStringField(input, 'from');
    const to = ToolActivitySummarizer.readStringField(input, 'to');
    if (!from && !to) {
      return undefined;
    }

    const segmentChars = Math.max(12, Math.floor(maxChars / 2));
    return `${tool} (${from ? truncate(from, segmentChars) : '?'} -> ${to ? truncate(to, segmentChars) : '?'})`;
  }

  private static summarizeSearchInput(tool: string, input: unknown, maxChars: number): string {
    const query = ToolActivitySummarizer.readStringField(input, 'query');
    if (!query) {
      return tool;
    }

    const path = ToolActivitySummarizer.readStringField(input, 'path');
    const segmentChars = Math.max(12, Math.floor(maxChars / 2));
    const querySummary = truncate(JSON.stringify(query), segmentChars);
    return path ?
        `${tool} (${querySummary} in ${truncate(path, segmentChars)})`
      : `${tool} (${querySummary})`;
  }

  private static summarizePlanInput(tool: string, input: unknown, maxChars: number): string {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return tool;
    }

    const plan = (input as { plan?: unknown }).plan;
    if (!Array.isArray(plan) || plan.length === 0) {
      return tool;
    }

    const currentStep = plan
      .map((item) => ToolActivitySummarizer.getPlanItemStep(item, 'in_progress'))
      .find((step): step is string => Boolean(step));
    return currentStep ? `${tool} (${truncate(currentStep, maxChars)})` : `${tool} (${plan.length} items)`;
  }

  private static getPlanItemStep(item: unknown, status: string): string | undefined {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return undefined;
    }

    const candidate = item as { status?: unknown; step?: unknown };
    return candidate.status === status && typeof candidate.step === 'string' ? candidate.step : undefined;
  }

  private static readStringField(value: unknown, field: string): string | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return undefined;
    }

    const candidate = (value as Record<string, unknown>)[field];
    return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : undefined;
  }
}
