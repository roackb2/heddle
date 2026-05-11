import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TraceEvent } from '../../../types.js';

export type SaveTraceOptions = {
  traceFile?: string;
};

export type LiveTraceWriter = {
  traceFile: string;
  record: (event: TraceEvent) => void;
  replace: (trace: TraceEvent[]) => string;
};

export function saveTrace(traceDir: string, trace: TraceEvent[], options: SaveTraceOptions = {}): string {
  mkdirSync(traceDir, { recursive: true });
  const traceFile = options.traceFile ?? join(traceDir, `trace-${Date.now()}.json`);
  writeFileSync(traceFile, JSON.stringify(trace, null, 2));
  return traceFile;
}

export function createLiveTraceWriter(traceDir: string): LiveTraceWriter {
  const traceFile = saveTrace(traceDir, []);
  const events: TraceEvent[] = [];

  return {
    traceFile,
    record(event) {
      events.push(event);
      saveTrace(traceDir, events, { traceFile });
    },
    replace(trace) {
      events.splice(0, events.length, ...trace);
      return saveTrace(traceDir, events, { traceFile });
    },
  };
}
