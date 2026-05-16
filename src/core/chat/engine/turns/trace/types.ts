import type { TraceEvent } from '@/core/types.js';

export type WriteTraceArgs = {
  traceDir: string;
  trace: TraceEvent[];
};
