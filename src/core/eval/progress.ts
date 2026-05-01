import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type EvalProgressEvent = {
  timestamp: string;
  caseId: string;
  phase: string;
  status: 'started' | 'heartbeat' | 'completed' | 'failed' | 'info';
  message: string;
  elapsedMs?: number;
};

export class EvalProgressReporter {
  readonly progressPath: string;
  private readonly caseId: string;
  private readonly writeStdout: boolean;

  constructor(args: {
    caseId: string;
    progressPath: string;
    writeStdout?: boolean;
  }) {
    this.caseId = args.caseId;
    this.progressPath = args.progressPath;
    this.writeStdout = args.writeStdout ?? true;
    mkdirSync(dirname(this.progressPath), { recursive: true });
  }

  info(phase: string, message: string) {
    this.write({
      timestamp: new Date().toISOString(),
      caseId: this.caseId,
      phase,
      status: 'info',
      message,
    });
  }

  async track<T>(args: {
    phase: string;
    message: string;
    heartbeatMessage?: string;
    heartbeatMs?: number;
    run: () => Promise<T>;
  }): Promise<T> {
    const startedAt = Date.now();
    this.write({
      timestamp: new Date(startedAt).toISOString(),
      caseId: this.caseId,
      phase: args.phase,
      status: 'started',
      message: args.message,
      elapsedMs: 0,
    });

    const heartbeatMs = args.heartbeatMs ?? 30_000;
    const interval = heartbeatMs > 0 ?
      setInterval(() => {
        const elapsedMs = Date.now() - startedAt;
        this.write({
          timestamp: new Date().toISOString(),
          caseId: this.caseId,
          phase: args.phase,
          status: 'heartbeat',
          message: args.heartbeatMessage ?? `still running ${args.message}`,
          elapsedMs,
        });
      }, heartbeatMs)
    : undefined;

    try {
      const result = await args.run();
      const elapsedMs = Date.now() - startedAt;
      this.write({
        timestamp: new Date().toISOString(),
        caseId: this.caseId,
        phase: args.phase,
        status: 'completed',
        message: args.message,
        elapsedMs,
      });
      return result;
    } catch (error) {
      const elapsedMs = Date.now() - startedAt;
      this.write({
        timestamp: new Date().toISOString(),
        caseId: this.caseId,
        phase: args.phase,
        status: 'failed',
        message: error instanceof Error ? error.message : String(error),
        elapsedMs,
      });
      throw error;
    } finally {
      if (interval) {
        clearInterval(interval);
      }
    }
  }

  private write(event: EvalProgressEvent) {
    appendFileSync(this.progressPath, `${JSON.stringify(event)}\n`, 'utf8');
    if (this.writeStdout) {
      process.stdout.write(formatProgressLine(event));
    }
  }
}

function formatProgressLine(event: EvalProgressEvent): string {
  const elapsed = event.elapsedMs === undefined ? '' : ` (${formatElapsed(event.elapsedMs)})`;
  return `[${event.caseId}] ${event.status}: ${event.message}${elapsed}\n`;
}

function formatElapsed(elapsedMs: number): string {
  if (elapsedMs < 1000) {
    return `${elapsedMs}ms`;
  }
  return `${Math.round(elapsedMs / 1000)}s`;
}
