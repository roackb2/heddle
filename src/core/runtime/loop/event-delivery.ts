import type { AgentLoopEvent, AgentLoopEventListener } from './types.js';

/**
 * Preserves immediate synchronous listeners while serializing async delivery.
 */
export class AgentLoopEventDelivery {
  private pending?: Promise<void>;

  constructor(private readonly listener?: AgentLoopEventListener) {}

  emit(event: AgentLoopEvent): void {
    if (!this.listener) {
      return;
    }
    if (!this.pending) {
      const result = this.listener(event);
      if (AgentLoopEventDelivery.isPromiseLike(result)) {
        this.track(Promise.resolve(result));
      }
      return;
    }

    this.track(this.pending.then(() => this.listener?.(event)));
  }

  async settle(): Promise<void> {
    await this.pending;
  }

  private track(pending: Promise<void>): void {
    this.pending = pending;
    // The owning run awaits the original Promise before settling. Attach an
    // immediate observer so an early rejection is not reported as unhandled
    // while model/tool work is still in flight.
    void pending.catch(() => undefined);
  }

  private static isPromiseLike(value: unknown): value is PromiseLike<void> {
    return (typeof value === 'object' || typeof value === 'function')
      && value !== null
      && 'then' in value
      && typeof value.then === 'function';
  }
}
