import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TraceEvent } from '../types.js';

export function saveTrace(traceDir: string, trace: TraceEvent[]): string {
  mkdirSync(traceDir, { recursive: true });
  const traceFile = join(traceDir, `trace-${Date.now()}.json`);
  writeFileSync(traceFile, JSON.stringify(trace, null, 2));
  return traceFile;
}
