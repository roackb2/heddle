import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TraceEvent } from '@/core/types.js';

/**
 * Writes persisted turn trace files.
 */
export class TraceWriter {
  static write(traceDir: string, trace: TraceEvent[]): string {
    mkdirSync(traceDir, { recursive: true });
    const traceFile = join(traceDir, `trace-${Date.now()}.json`);
    writeFileSync(traceFile, JSON.stringify(trace, null, 2));
    return traceFile;
  }
}
