import type { TraceEvent } from '@/core/types.js';

/**
 * Mutable in-memory recorder for one trace-producing run.
 *
 * This class owns event accumulation only. Projection, summaries, and
 * user-facing review views belong in observability or review domains.
 */
export class TraceRecorder {
  private readonly events: TraceEvent[] = [];

  record(event: TraceEvent): void {
    this.events.push(event);
  }

  getTrace(): TraceEvent[] {
    return [...this.events];
  }

  toJSON(): string {
    return JSON.stringify(this.events, null, 2);
  }
}
