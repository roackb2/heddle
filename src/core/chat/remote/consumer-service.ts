import type {
  ConversationRunConsumerEvent,
  ConversationRunConsumerServiceOptions,
  ConversationRunEventAcceptance,
  ConversationRunReference,
  ConversationRunRetry,
  ConversationRunSubscriptionInput,
} from './types.js';

const DEFAULT_MAX_RECONNECT_ATTEMPTS = 6;
const DEFAULT_RECONNECT_BASE_DELAY_MS = 500;
const DEFAULT_RECONNECT_MAX_DELAY_MS = 4_000;
const EVENT_KINDS = new Set(['activity', 'result', 'cancelled', 'error']);

type ResolvedRetryOptions = {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
};

export class ConversationRunSequenceGapError extends Error {
  constructor(
    readonly runId: string,
    readonly expectedSequence: number,
    readonly receivedSequence: number,
  ) {
    super(
      `Conversation run stream sequence gap for ${runId}: expected ${expectedSequence}, received ${receivedSequence}.`,
    );
  }
}

export class ConversationRunTerminalViolationError extends Error {
  constructor(readonly runId: string, readonly receivedSequence: number) {
    super(`Conversation run ${runId} received sequence ${receivedSequence} after its terminal event.`);
  }
}

/**
 * Owns transport-neutral cursor correctness and bounded reconnect policy for
 * one remotely observed conversation run.
 */
export class ConversationRunConsumerService<
  Reference extends ConversationRunReference = ConversationRunReference,
> {
  private readonly retry: ResolvedRetryOptions;
  private run?: Reference;
  private sequence = 0;
  private terminal = false;
  private retryAttempt = 0;

  constructor(options: ConversationRunConsumerServiceOptions = {}) {
    this.retry = ConversationRunConsumerService.resolveRetryOptions(options.retry);
  }

  select(run: Reference): boolean {
    ConversationRunConsumerService.assertRunId(run.runId);
    if (this.isCurrent(run)) {
      return false;
    }

    this.run = run;
    this.sequence = 0;
    this.terminal = false;
    this.retryAttempt = 0;
    return true;
  }

  accept(event: ConversationRunConsumerEvent): ConversationRunEventAcceptance {
    if (!this.run || event.runId !== this.run.runId) {
      return { accepted: false, terminal: false };
    }

    ConversationRunConsumerService.assertEvent(event);
    if (event.sequence <= this.sequence) {
      return { accepted: false, terminal: this.terminal };
    }
    if (this.terminal) {
      throw new ConversationRunTerminalViolationError(event.runId, event.sequence);
    }

    const expectedSequence = this.sequence + 1;
    if (event.sequence !== expectedSequence) {
      throw new ConversationRunSequenceGapError(event.runId, expectedSequence, event.sequence);
    }

    this.sequence = event.sequence;
    this.terminal = event.kind !== 'activity';
    this.retryAttempt = 0;
    return { accepted: true, terminal: this.terminal };
  }

  subscriptionInput(): ConversationRunSubscriptionInput<Reference> | undefined {
    if (!this.run || this.terminal) {
      return undefined;
    }

    return {
      ...this.run,
      afterSequence: this.sequence,
    };
  }

  nextRetry(): ConversationRunRetry<Reference> | undefined {
    const input = this.subscriptionInput();
    if (!input) {
      return undefined;
    }

    const nextAttempt = this.retryAttempt + 1;
    if (nextAttempt > this.retry.maxAttempts) {
      return undefined;
    }

    this.retryAttempt = nextAttempt;
    return {
      attempt: nextAttempt,
      delayMs: Math.min(
        this.retry.baseDelayMs * 2 ** (nextAttempt - 1),
        this.retry.maxDelayMs,
      ),
      input,
    };
  }

  isCurrent(run: Reference): boolean {
    return this.run?.runId === run.runId;
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

  private static resolveRetryOptions(
    options: ConversationRunConsumerServiceOptions['retry'] = {},
  ): ResolvedRetryOptions {
    const resolved = {
      maxAttempts: options.maxAttempts ?? DEFAULT_MAX_RECONNECT_ATTEMPTS,
      baseDelayMs: options.baseDelayMs ?? DEFAULT_RECONNECT_BASE_DELAY_MS,
      maxDelayMs: options.maxDelayMs ?? DEFAULT_RECONNECT_MAX_DELAY_MS,
    };

    ConversationRunConsumerService.assertNonNegativeSafeInteger(
      'Conversation run max reconnect attempts',
      resolved.maxAttempts,
    );
    ConversationRunConsumerService.assertNonNegativeSafeInteger(
      'Conversation run reconnect base delay',
      resolved.baseDelayMs,
    );
    ConversationRunConsumerService.assertNonNegativeSafeInteger(
      'Conversation run reconnect maximum delay',
      resolved.maxDelayMs,
    );
    if (resolved.maxDelayMs < resolved.baseDelayMs) {
      throw new Error('Conversation run reconnect maximum delay cannot be less than its base delay.');
    }
    return resolved;
  }

  private static assertEvent(event: ConversationRunConsumerEvent): void {
    ConversationRunConsumerService.assertRunId(event.runId);
    if (!Number.isSafeInteger(event.sequence) || event.sequence < 1) {
      throw new Error('Conversation run event sequence must be a positive safe integer.');
    }
    if (!EVENT_KINDS.has(event.kind)) {
      throw new Error(`Unsupported conversation run event kind: ${String(event.kind)}.`);
    }
  }

  private static assertRunId(runId: string): void {
    if (typeof runId !== 'string' || !runId.trim()) {
      throw new Error('Conversation run references require a non-empty runId.');
    }
  }

  private static assertNonNegativeSafeInteger(label: string, value: number): void {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`${label} must be a non-negative safe integer.`);
    }
  }
}
