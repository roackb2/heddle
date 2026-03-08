// ---------------------------------------------------------------------------
// Trace Recorder
// ---------------------------------------------------------------------------

import type { TraceEvent } from '../types.js';

export type TraceRecorder = {
  record(event: TraceEvent): void;
  getTrace(): TraceEvent[];
  toJSON(): string;
};

/**
 * Create a trace recorder that accumulates events in memory.
 */
export function createTraceRecorder(): TraceRecorder {
  const events: TraceEvent[] = [];

  return {
    record(event: TraceEvent) {
      events.push(event);
    },
    getTrace() {
      return [...events];
    },
    toJSON() {
      return JSON.stringify(events, null, 2);
    },
  };
}
