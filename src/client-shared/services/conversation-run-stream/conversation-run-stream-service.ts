import type { ControlPlaneSessionRunEventEnvelope } from '@/client-shared/api/types.js';

const DEFAULT_MAX_RECONNECT_ATTEMPTS = 6;
const DEFAULT_RECONNECT_BASE_DELAY_MS = 500;
const DEFAULT_RECONNECT_MAX_DELAY_MS = 4_000;

export type ClientSharedConversationRunReference = {
  workspaceId: string;
  sessionId: string;
  runId: string;
};

export type ClientSharedConversationRunSubscriptionInput = ClientSharedConversationRunReference & {
  afterSequence: number;
};

export type ClientSharedConversationRunRetry = {
  attempt: number;
  delayMs: number;
  input: ClientSharedConversationRunSubscriptionInput;
};

export type ClientSharedConversationRunEventAcceptance = {
  accepted: boolean;
  terminal: boolean;
};

/**
 * Owns frontend-neutral run cursor correctness and bounded reconnect policy.
 *
 * Transport adapters remain host-owned. This service prevents CLI and web from
 * diverging on run selection, duplicate suppression, sequence gaps, terminal
 * detection, and replay cursor advancement.
 */
export class ClientSharedConversationRunStreamService {
  private run?: ClientSharedConversationRunReference;
  private sequence = 0;
  private terminal = false;
  private retryAttempt = 0;

  select(run: ClientSharedConversationRunReference): boolean {
    if (this.isCurrent(run)) {
      return false;
    }

    this.run = run;
    this.sequence = 0;
    this.terminal = false;
    this.retryAttempt = 0;
    return true;
  }

  accept(event: ControlPlaneSessionRunEventEnvelope): ClientSharedConversationRunEventAcceptance {
    if (!this.run || event.runId !== this.run.runId) {
      return { accepted: false, terminal: false };
    }
    if (event.sequence <= this.sequence) {
      return { accepted: false, terminal: this.terminal };
    }

    const expectedSequence = this.sequence + 1;
    if (event.sequence !== expectedSequence) {
      throw new Error(
        `Conversation run stream sequence gap for ${event.runId}: expected ${expectedSequence}, received ${event.sequence}.`,
      );
    }

    this.sequence = event.sequence;
    this.terminal = event.kind !== 'activity';
    this.retryAttempt = 0;
    return { accepted: true, terminal: this.terminal };
  }

  subscriptionInput(): ClientSharedConversationRunSubscriptionInput | undefined {
    if (!this.run || this.terminal) {
      return undefined;
    }

    return {
      ...this.run,
      afterSequence: this.sequence,
    };
  }

  nextRetry(options: {
    maxAttempts?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
  } = {}): ClientSharedConversationRunRetry | undefined {
    const input = this.subscriptionInput();
    if (!input) {
      return undefined;
    }

    const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_RECONNECT_ATTEMPTS;
    const nextAttempt = this.retryAttempt + 1;
    if (nextAttempt > maxAttempts) {
      return undefined;
    }

    this.retryAttempt = nextAttempt;
    const baseDelayMs = options.baseDelayMs ?? DEFAULT_RECONNECT_BASE_DELAY_MS;
    const maxDelayMs = options.maxDelayMs ?? DEFAULT_RECONNECT_MAX_DELAY_MS;
    return {
      attempt: nextAttempt,
      delayMs: Math.min(baseDelayMs * 2 ** (nextAttempt - 1), maxDelayMs),
      input,
    };
  }

  isCurrent(run: ClientSharedConversationRunReference): boolean {
    return Boolean(
      this.run
      && this.run.workspaceId === run.workspaceId
      && this.run.sessionId === run.sessionId
      && this.run.runId === run.runId,
    );
  }

  isTerminal(): boolean {
    return this.terminal;
  }

  clear(runId?: string): void {
    if (runId !== undefined && this.run?.runId !== runId) {
      return;
    }

    this.run = undefined;
    this.sequence = 0;
    this.terminal = false;
    this.retryAttempt = 0;
  }
}
