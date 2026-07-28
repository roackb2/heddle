import {
  SESSION_LEASE_REFRESH_INTERVAL_MS,
  type ChatSessionLeaseClaim,
} from '@/core/chat/engine/sessions/leases/index.js';
import type { ConversationTurnLeaseHeartbeatOptions } from './types.js';

/**
 * Keeps one acquired turn lease alive until the turn settles.
 *
 * Renewal is intentionally time-based. Model requests can be silent for longer
 * than the lease TTL, so activity-driven refresh would still fence healthy
 * long-running turns.
 */
export class ConversationTurnLeaseHeartbeatService {
  readonly signal: AbortSignal;

  private readonly controller = new AbortController();
  private readonly refreshIntervalMs: number;
  private claim?: ChatSessionLeaseClaim;
  private timer?: ReturnType<typeof setTimeout>;
  private refreshInFlight?: Promise<void>;
  private failure: unknown;
  private failed = false;
  private started = false;
  private stopped = false;

  constructor(private readonly options: ConversationTurnLeaseHeartbeatOptions) {
    this.refreshIntervalMs = options.refreshIntervalMs ?? SESSION_LEASE_REFRESH_INTERVAL_MS;
    if (!Number.isSafeInteger(this.refreshIntervalMs) || this.refreshIntervalMs < 1) {
      throw new Error('Conversation turn lease refresh interval must be a positive integer.');
    }
    this.signal = this.controller.signal;
  }

  /**
   * Starts renewal for the exact fenced claim acquired by preflight.
   */
  start(claim: ChatSessionLeaseClaim): void {
    if (this.started) {
      throw new Error('Conversation turn lease heartbeat has already started.');
    }
    if (this.stopped) {
      throw new Error('Conversation turn lease heartbeat has already stopped.');
    }

    this.started = true;
    this.claim = claim;
    this.scheduleNextRefresh();
  }

  /**
   * Stops scheduling and waits for a refresh already in progress.
   */
  async stop(): Promise<void> {
    if (this.stopped) {
      await this.refreshInFlight;
      return;
    }

    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    await this.refreshInFlight;
  }

  /**
   * Re-throws the renewal failure before the turn attempts another phase.
   */
  throwIfFailed(): void {
    if (this.failed) {
      throw this.failure;
    }
  }

  private scheduleNextRefresh(): void {
    const claim = this.claim;
    if (this.stopped || this.failed || !claim) {
      return;
    }

    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.refreshInFlight = this.refreshLease(claim);
      void this.refreshInFlight.finally(() => {
        this.refreshInFlight = undefined;
        this.scheduleNextRefresh();
      });
    }, this.refreshIntervalMs);
    this.timer.unref?.();
  }

  private async refreshLease(claim: ChatSessionLeaseClaim): Promise<void> {
    try {
      await this.options.sessionService.refreshLease(this.options.sessionId, claim);
    } catch (error) {
      this.failed = true;
      this.failure = error;
      this.controller.abort(error);
    }
  }
}
