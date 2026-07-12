/**
 * Stage 05.1: host application lifecycle above Heddle's conversation/run APIs.
 *
 * This module assumes the host owns authenticated account scope, stable product
 * session IDs, composition, and process lifetime. It deliberately has no HTTP,
 * transport, or UI dependency; those belong in later optional stages.
 */
import pick from 'lodash/pick.js';
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

export type HostedAgentResult = Pick<ConversationTurnResultSummary, 'outcome' | 'summary'>;

export type HostedAgentRunStreamItem = ConversationRunStreamItem<HostedAgentResult>;

export type HostedAgentConversationMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  isPending?: boolean;
  isStreaming?: boolean;
};

export type HostedAgentConversation = {
  sessionId: string;
  messages: HostedAgentConversationMessage[];
  activeRun?: {
    runId: string;
    acceptedAt: string;
  };
};

export type HostedAgentServiceOptions = {
  createEngine(address: HostedRunAddress): ConversationEngine | Promise<ConversationEngine>;
  createHost?(address: HostedRunAddress): ConversationEngineHost | Promise<ConversationEngineHost>;
  replay?: ConversationRunReplayOptions;
};

export class HostedAgentRunNotFoundError extends Error {}
export class HostedAgentConversationBusyError extends Error {}
export class HostedAgentInputError extends Error {}

/**
 * Owns the application-level lifecycle for a hosted conversational agent.
 *
 * Heddle owns conversation execution and replay. This service owns account
 * scoping, engine/session construction, public conversation projection, and
 * authorization of run handles.
 * Authentication verification happens before this service; HTTP, SSE, and UI
 * state stay outside it.
 */
export class HostedAgentService {
  private readonly runs: ConversationRunService<HostedRunAddress>;

  constructor(private readonly options: HostedAgentServiceOptions) {
    this.runs = new ConversationRunService<HostedRunAddress>({
      addressKey: ({ accountId, sessionId }) => JSON.stringify([accountId, sessionId]),
      replay: options.replay,
    });
  }

  async start(input: StartHostedAgentRunInput): Promise<HostedAgentRunAccepted> {
    const address = HostedAgentService.normalizeAddress(input);
    const prompt = input.prompt.trim();
    if (!prompt) {
      throw new HostedAgentInputError('Hosted agent prompts cannot be empty.');
    }
    const engine = await this.options.createEngine(address);
    const host = await this.options.createHost?.(address);
    const session = engine.sessions.readExisting(address.sessionId)
      ?? engine.sessions.create({ id: address.sessionId, name: 'Hosted agent conversation' });

    const run = this.runs.startTurn({
      address,
      engine,
      turn: {
        sessionId: session.id,
        prompt,
        host,
      },
      // Projection is awaited before Heddle publishes the terminal result.
      // Real hosts can persist or reconcile authorized product state here and
      // return only the public data that reconnecting clients may replay.
      projectResult: (result): HostedAgentResult => ({
        outcome: result.outcome,
        summary: result.summary,
      }),
      projectError: () => ({
        code: 'run_failed',
        message: 'The hosted agent could not complete this request.',
      }),
    });

    return {
      accepted: true,
      runId: run.runId,
      acceptedAt: run.acceptedAt,
      sessionId: session.id,
    };
  }

  async readConversation(input: HostedRunAddress): Promise<HostedAgentConversation> {
    const address = HostedAgentService.normalizeAddress(input);
    const engine = await this.options.createEngine(address);
    return this.projectConversation(
      address,
      engine.sessions.readExisting(address.sessionId)?.messages ?? [],
    );
  }

  async resetConversation(input: HostedRunAddress): Promise<HostedAgentConversation> {
    const address = HostedAgentService.normalizeAddress(input);
    if (this.runs.isRunning(address)) {
      throw new HostedAgentConversationBusyError(
        `Cannot reset session ${address.sessionId} while a run is active.`,
      );
    }

    const engine = await this.options.createEngine(address);
    const session = engine.sessions.readExisting(address.sessionId);
    return this.projectConversation(
      address,
      session ? engine.sessions.resetConversation(session.id).messages : [],
    );
  }

  subscribe(input: {
    accountId: string;
    runId: string;
    afterSequence?: number;
    signal?: AbortSignal;
  }): AsyncIterable<HostedAgentRunStreamItem> {
    return this.requireOwnedRun(input.accountId, input.runId).events({
      afterSequence: input.afterSequence,
      signal: input.signal,
    });
  }

  cancel(accountId: string, runId: string): boolean {
    return this.requireOwnedRun(accountId, runId).cancel();
  }

  private requireOwnedRun(
    accountId: string,
    runId: string,
  ): ConversationRunHandle<HostedRunAddress, HostedAgentResult> {
    const run = this.runs.getRetainedRun<HostedAgentResult>(runId);
    if (!run || run.accountId !== accountId.trim()) {
      throw new HostedAgentRunNotFoundError(`Hosted agent run not found: ${runId}`);
    }
    return run;
  }

  private projectConversation(
    address: HostedRunAddress,
    messages: HostedAgentConversationMessage[],
  ): HostedAgentConversation {
    const activeRun = this.runs.getActiveRun(address);
    return {
      sessionId: address.sessionId,
      messages: messages.map((message) => pick(
        message,
        ['id', 'role', 'text', 'isPending', 'isStreaming'],
      )),
      ...(activeRun ? {
        activeRun: {
          runId: activeRun.runId,
          acceptedAt: activeRun.acceptedAt,
        },
      } : {}),
    };
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
