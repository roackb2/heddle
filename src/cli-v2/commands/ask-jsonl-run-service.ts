import dayjs from 'dayjs';
import type { ControlPlaneProxyClient } from '@/client-shared/api/proxy.js';
import type { ControlPlaneSessionRunEventEnvelope } from '@/client-shared/api/types.js';
import { ControlPlaneSessionApiService } from '@/cli-v2/services/sessions/control-plane-session-api-service.js';
import { ControlPlaneSessionSubscriptionService } from '@/cli-v2/services/sessions/control-plane-session-subscription-service.js';

const ASK_JSONL_SCHEMA_VERSION = 1 as const;

type AskJsonlRunAddress = {
  workspaceId: string;
  sessionId: string;
  runId: string;
};

type AskJsonlRecord =
  | ({
    type: 'run.accepted';
    terminal: false;
    timestamp: string;
  } & AskJsonlRunAddress)
  | ({
    type: 'run.activity';
    terminal: false;
    sequence: number;
    timestamp: string;
    activity: Extract<ControlPlaneSessionRunEventEnvelope, { kind: 'activity' }>['activity'];
  } & AskJsonlRunAddress)
  | ({
    type: 'run.result';
    terminal: true;
    sequence: number;
    timestamp: string;
    result: Extract<ControlPlaneSessionRunEventEnvelope, { kind: 'result' }>['result'];
  } & AskJsonlRunAddress)
  | ({
    type: 'run.cancelled';
    terminal: true;
    sequence: number;
    timestamp: string;
    reason: string;
  } & AskJsonlRunAddress)
  | ({
    type: 'run.error';
    terminal: true;
    sequence: number;
    timestamp: string;
    error: Extract<ControlPlaneSessionRunEventEnvelope, { kind: 'error' }>['error'];
  } & AskJsonlRunAddress)
  | ({
    type: 'run.stream.reconnecting';
    terminal: false;
    timestamp: string;
    attempt: number;
    delayMs: number;
    error: { code: 'RUN_STREAM_INTERRUPTED'; message: string };
  } & AskJsonlRunAddress)
  | ({
    type: 'run.stream.error';
    terminal: true;
    timestamp: string;
    error: { code: 'RUN_STREAM_UNAVAILABLE'; message: string };
  } & AskJsonlRunAddress)
  | {
    type: 'command.error';
    terminal: true;
    timestamp: string;
    error: { code: 'ASK_COMMAND_FAILED'; message: string };
  };

type VersionedAskJsonlRecord = AskJsonlRecord & {
  schemaVersion: typeof ASK_JSONL_SCHEMA_VERSION;
};

export type AskJsonlRunServiceOptions = {
  client: ControlPlaneProxyClient;
  sessionApi: ControlPlaneSessionApiService;
  writer: AskJsonlProtocolWriter;
};

export type AskJsonlRunInput = {
  workspaceId: string;
  sessionId: string;
  prompt: string;
  agentProfileId: string;
};

/**
 * Writes the versioned `heddle ask --output jsonl` protocol and guarantees
 * that a command process emits no more than one terminal record.
 */
export class AskJsonlProtocolWriter {
  private terminalWritten = false;

  constructor(
    private readonly writeLine: (line: string) => void = (line) => {
      process.stdout.write(line);
    },
  ) {}

  write(record: AskJsonlRecord): boolean {
    if (this.terminalWritten) {
      return false;
    }

    this.terminalWritten = record.terminal;
    const versioned: VersionedAskJsonlRecord = {
      schemaVersion: ASK_JSONL_SCHEMA_VERSION,
      ...record,
    };
    this.writeLine(`${JSON.stringify(versioned)}\n`);
    return true;
  }

  writeCommandError(error: unknown): void {
    this.write({
      type: 'command.error',
      terminal: true,
      timestamp: dayjs().toISOString(),
      error: {
        code: 'ASK_COMMAND_FAILED',
        message: AskJsonlProtocolWriter.errorMessage(error),
      },
    });
  }

  private static errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}

/**
 * Supervises one exact control-plane run for the scriptable ask command.
 * Run execution, replay ordering, retry policy, and approval semantics remain
 * owned by the shared control-plane and conversation-run services.
 */
export class AskJsonlRunService {
  private readonly writer: AskJsonlProtocolWriter;
  private subscriptions?: ControlPlaneSessionSubscriptionService;
  private settle?: (exitCode: number) => void;

  constructor(private readonly options: AskJsonlRunServiceOptions) {
    this.writer = options.writer;
  }

  async run(input: AskJsonlRunInput): Promise<number> {
    const accepted = await this.options.sessionApi.sendPromptAsync({
      ...input,
      includePlanTool: false,
      memoryMaintenanceMode: 'inline',
      queueIfBusy: false,
    });
    if (!('accepted' in accepted)) {
      throw new Error('The scriptable ask could not acquire an exact run identity. Retry after the session queue settles.');
    }

    const run = {
      workspaceId: accepted.workspaceId,
      sessionId: accepted.sessionId,
      runId: accepted.runId,
    };
    this.writer.write({
      type: 'run.accepted',
      terminal: false,
      ...run,
      timestamp: accepted.acceptedAt,
    });

    return await new Promise<number>((resolve) => {
      this.settle = resolve;
      this.subscriptions = new ControlPlaneSessionSubscriptionService({
        client: this.options.client,
        onSessionsUpdated: () => undefined,
        onSessionEvent: () => undefined,
        onRunEvent: (_workspaceId, _sessionId, event) => this.handleRunEvent(run, event),
        onSessionListError: () => undefined,
        onSessionStreamError: () => undefined,
        onSessionStreamStarted: () => undefined,
        onSessionStreamComplete: () => undefined,
        onRunStreamError: (error) => this.finish(1, {
          type: 'run.stream.error',
          terminal: true,
          ...run,
          timestamp: dayjs().toISOString(),
          error: {
            code: 'RUN_STREAM_UNAVAILABLE',
            message: error.message,
          },
        }),
        onRunStreamStarted: () => undefined,
        onRunStreamReconnecting: ({ attempt, delayMs, error }) => {
          this.writer.write({
            type: 'run.stream.reconnecting',
            terminal: false,
            ...run,
            timestamp: dayjs().toISOString(),
            attempt,
            delayMs,
            error: {
              code: 'RUN_STREAM_INTERRUPTED',
              message: error.message,
            },
          });
        },
        onRunStreamComplete: () => undefined,
      });

      try {
        this.subscriptions.subscribeToAcceptedRun(run);
      } catch (error) {
        this.finish(1, {
          type: 'run.stream.error',
          terminal: true,
          ...run,
          timestamp: dayjs().toISOString(),
          error: {
            code: 'RUN_STREAM_UNAVAILABLE',
            message: error instanceof Error ? error.message : String(error),
          },
        });
      }
    });
  }

  private handleRunEvent(run: AskJsonlRunAddress, event: ControlPlaneSessionRunEventEnvelope): void {
    if (event.kind === 'activity') {
      this.writer.write({
        type: 'run.activity',
        terminal: false,
        ...run,
        sequence: event.sequence,
        timestamp: event.timestamp,
        activity: event.activity,
      });
      return;
    }

    if (event.kind === 'result') {
      this.finish(event.result.outcome === 'done' ? 0 : 1, {
        type: 'run.result',
        terminal: true,
        ...run,
        sequence: event.sequence,
        timestamp: event.timestamp,
        result: event.result,
      });
      return;
    }

    if (event.kind === 'cancelled') {
      this.finish(1, {
        type: 'run.cancelled',
        terminal: true,
        ...run,
        sequence: event.sequence,
        timestamp: event.timestamp,
        reason: event.reason,
      });
      return;
    }

    this.finish(1, {
      type: 'run.error',
      terminal: true,
      ...run,
      sequence: event.sequence,
      timestamp: event.timestamp,
      error: event.error,
    });
  }

  private finish(exitCode: number, record: Extract<AskJsonlRecord, { terminal: true }>): void {
    if (!this.writer.write(record)) {
      return;
    }

    this.subscriptions?.dispose();
    this.subscriptions = undefined;
    this.settle?.(exitCode);
    this.settle = undefined;
  }
}
