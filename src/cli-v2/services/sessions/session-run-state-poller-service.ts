export type SessionRunStatePollAddress = {
  workspaceId: string;
  sessionId: string;
};

export type SessionRunStatePollerServiceOptions = {
  intervalMs: number;
  getAddress: () => SessionRunStatePollAddress | undefined;
  isEnabled: () => boolean;
  poll: (address: SessionRunStatePollAddress) => Promise<void>;
  onError: (error: unknown) => void;
};

/**
 * Owns cli-v2 run-state polling mechanics for active terminal sessions.
 */
export class SessionRunStatePollerService {
  private timer?: ReturnType<typeof setInterval>;
  private inFlight = false;

  constructor(private readonly options: SessionRunStatePollerServiceOptions) {}

  sync(): void {
    const address = this.options.getAddress();
    if (!this.options.isEnabled() || !address) {
      this.stop();
      return;
    }

    if (this.timer) {
      return;
    }

    this.timer = setInterval(() => {
      void this.tick();
    }, this.options.intervalMs);
  }

  dispose(): void {
    this.stop();
    this.inFlight = false;
  }

  private stop(): void {
    if (!this.timer) {
      return;
    }

    clearInterval(this.timer);
    this.timer = undefined;
  }

  private async tick(): Promise<void> {
    const address = this.options.getAddress();
    if (!address || this.inFlight) {
      return;
    }

    this.inFlight = true;
    try {
      await this.options.poll(address);
    } catch (error) {
      this.options.onError(error);
    } finally {
      this.inFlight = false;
    }
  }
}
