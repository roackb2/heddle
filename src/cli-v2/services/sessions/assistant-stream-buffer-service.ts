export type AssistantStreamUpdate = {
  workspaceId: string;
  sessionId: string;
  text: string;
  done: boolean | undefined;
};

export type AssistantStreamBufferServiceOptions = {
  renderIntervalMs: number;
  canApply: (update: AssistantStreamUpdate) => boolean;
  apply: (update: AssistantStreamUpdate) => void;
};

/**
 * Coalesces rapid terminal assistant stream updates so Ink renders the newest
 * cumulative text instead of replaying stale partial chunks.
 */
export class AssistantStreamBufferService {
  private pendingUpdate?: AssistantStreamUpdate;
  private flushTimer?: ReturnType<typeof setTimeout>;
  private lastAppliedAt = 0;

  constructor(private readonly options: AssistantStreamBufferServiceOptions) {}

  push(update: AssistantStreamUpdate): void {
    if (!this.options.canApply(update)) {
      return;
    }

    if (update.done || this.shouldApplyNow()) {
      this.clearPendingFlush();
      this.apply(update);
      return;
    }

    this.pendingUpdate = update;
    this.scheduleFlush();
  }

  flush(): void {
    const update = this.pendingUpdate;
    this.clearPendingFlush();
    if (!update || !this.options.canApply(update)) {
      return;
    }

    this.apply(update);
  }

  reset(): void {
    this.clearPendingFlush();
    this.lastAppliedAt = 0;
  }

  dispose(): void {
    this.reset();
  }

  private shouldApplyNow(): boolean {
    const nowMs = Date.now();
    if (!this.lastAppliedAt || nowMs - this.lastAppliedAt >= this.options.renderIntervalMs) {
      this.lastAppliedAt = nowMs;
      return true;
    }

    return false;
  }

  private scheduleFlush(): void {
    if (this.flushTimer) {
      return;
    }

    const elapsedMs = Date.now() - this.lastAppliedAt;
    const delayMs = Math.max(0, this.options.renderIntervalMs - elapsedMs);
    this.flushTimer = setTimeout(() => this.flush(), delayMs);
  }

  private clearPendingFlush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
    }
    this.flushTimer = undefined;
    this.pendingUpdate = undefined;
  }

  private apply(update: AssistantStreamUpdate): void {
    this.lastAppliedAt = Date.now();
    this.options.apply(update);
  }
}
