import type { TraceEvent } from '@/core/types.js';

export type TraceRecordSink = {
  record(event: TraceEvent): void;
  getTrace(): TraceEvent[];
  toJSON(): string;
};
