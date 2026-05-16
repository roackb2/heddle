import { MAX_ROLLING_SUMMARY_CHARS } from './constants.js';

/**
 * Small formatting helpers for compaction prompts and compacted history text.
 */
export class CompactionText {
  static truncateSummary(value: string): string {
    if (value.length <= MAX_ROLLING_SUMMARY_CHARS) {
      return value;
    }

    return `${value.slice(0, MAX_ROLLING_SUMMARY_CHARS - 1).trimEnd()}…`;
  }

  static truncateForSummary(value: string, maxChars: number): string {
    if (value.length <= maxChars) {
      return value;
    }

    return `${value.slice(0, Math.max(0, maxChars - 80)).trimEnd()}\n\n[truncated ${value.length - maxChars} chars; full content is in the raw archive]`;
  }

  static truncateLine(value: string, maxChars: number): string {
    const compact = value.replace(/\s+/g, ' ').trim();
    if (compact.length <= maxChars) {
      return compact;
    }

    return `${compact.slice(0, maxChars - 1).trimEnd()}…`;
  }
}
