/**
 * Stage 05.1: host application lifecycle above Heddle's conversation/run APIs.
 *
 * This module assumes the host owns authenticated account scope, stable product
 * session IDs, composition, and process lifetime. It deliberately has no HTTP,
 * transport, or UI dependency; those belong in later optional stages.
 */
import {
  type ConversationEngine,
  type ConversationEngineHost,
  type ConversationTurnResultSummary,
} from '../../../../src/index.js';
import {
  ConversationRunService,
  type ConversationRunHandle,
  type ConversationRunReplayOptions,
  type ConversationRunStreamItem,
} from '../../../../src/hosted.js';

const DEFAULT_RUN_RETENTION_MS = 5 * 60_000;

export type HostedRunAddress = {
  accountId: string;
  sessionId: string;
};

export type StartHostedAgentRunInput = HostedRunAddress & {
  prompt: string;
};

export type HostedAgentRunAccepted = {
  accepted: true;
  runId: string;
  acceptedAt: string;
  sessionId: string;
};

export type HostedAgentRunStreamItem = ConversationRunStreamItem<ConversationTurnResultSummary>;

export type HostedAgentServiceOptions = {
  createEngine(address: HostedRunAddress): ConversationEngine | Promise<ConversationEngine>;
  createHost?(address: HostedRunAddress): ConversationEngineHost | Promise<ConversationEngineHost>;
  replay?: ConversationRunReplayOptions;
};

type HostedRunContext = {
  address: HostedRunAddress;
  run: ConversationRunHandle<HostedRunAddress, ConversationTurnResultSummary>;
};

export class HostedAgentRunNotFoundError extends Error {}
export class HostedAgentRunConflictError extends Error {}
export class HostedAgentInputError extends Error {}

/**
 * Owns the application-level lifecycle for a hosted conversational agent.
 *
 * Heddle owns conversation execution and replay. This service owns account
 * scoping, engine/session construction, and authorization of run handles.
 * Authentication verification happens before this service; HTTP, SSE, and UI
 * state stay outside it.
 */
export class HostedAgentService {
  private readonly runs: ConversationRunService<HostedRunAddress>;
  private readonly contexts = new Map<string, HostedRunContext>();
  private readonly retentionMs: number;

  constructor(private readonly options: HostedAgentServiceOptions) {
    this.retentionMs = options.replay?.retentionMs ?? DEFAULT_RUN_RETENTION_MS;
    this.runs = new ConversationRunService<HostedRunAddress>({
      addressKey: ({ accountId, sessionId }) => JSON.stringify([accountId, sessionId]),
      replay: {
        maxEventsPerRun: options.replay?.maxEventsPerRun,
        retentionMs: this.retentionMs,
      },
    });
  }

  async start(input: StartHostedAgentRunInput): Promise<HostedAgentRunAccepted> {
    const address = HostedAgentService.normalizeAddress(input);
    const prompt = input.prompt.trim();
    if (!prompt) {
      throw new HostedAgentInputError('Hosted agent prompts cannot be empty.');
    }
    if (this.runs.isRunning(address)) {
      throw new HostedAgentRunConflictError(`A run is already active for session ${address.sessionId}.`);
    }

    const engine = await this.options.createEngine(address);
    const host = await this.options.createHost?.(address);
    const session = engine.sessions.readExisting(address.sessionId)
      ?? engine.sessions.create({ id: address.sessionId, name: 'Hosted agent conversation' });

    if (this.runs.isRunning(address)) {
      throw new HostedAgentRunConflictError(`A run is already active for session ${address.sessionId}.`);
    }

    const run = this.runs.startTurn({
      address,
      engine,
      turn: {
        sessionId: session.id,
        prompt,
        host,
      },
    });

    this.contexts.set(run.runId, { address, run });
    this.expireContext(run);

    return {
      accepted: true,
      runId: run.runId,
      acceptedAt: run.acceptedAt,
      sessionId: session.id,
    };
  }

  subscribe(input: {
    accountId: string;
    runId: string;
    afterSequence?: number;
    signal?: AbortSignal;
  }): AsyncIterable<HostedAgentRunStreamItem> {
    return this.requireOwnedRun(input.accountId, input.runId).run.events({
      afterSequence: input.afterSequence,
      signal: input.signal,
    });
  }

  cancel(accountId: string, runId: string): boolean {
    return this.requireOwnedRun(accountId, runId).run.cancel();
  }

  private requireOwnedRun(accountId: string, runId: string): HostedRunContext {
    const context = this.contexts.get(runId);
    if (!context || context.address.accountId !== accountId.trim()) {
      throw new HostedAgentRunNotFoundError(`Hosted agent run not found: ${runId}`);
    }
    return context;
  }

  private expireContext(run: HostedRunContext['run']): void {
    void run.result.finally(() => {
      if (this.retentionMs === 0) {
        this.contexts.delete(run.runId);
        return;
      }

      const timer = setTimeout(() => this.contexts.delete(run.runId), this.retentionMs);
      timer.unref?.();
    }).catch(() => undefined);
  }

  private static normalizeAddress(input: { accountId: string; sessionId: string }): HostedRunAddress {
    const address = {
      accountId: input.accountId.trim(),
      sessionId: input.sessionId.trim(),
    };
    if (!address.accountId || !address.sessionId) {
      throw new HostedAgentInputError('Hosted runs require non-empty account and session IDs.');
    }
    return address;
  }
}
