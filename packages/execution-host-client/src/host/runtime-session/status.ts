export type RuntimeSessionStatusSnapshot = {
  state: 'idle' | 'executing';
  changedAtUnixSeconds: number;
};

/** Tracks process-local execution status without provider-specific vocabulary. */
export class RuntimeSessionStatusService {
  private state: RuntimeSessionStatusSnapshot['state'] = 'idle';
  private changedAtUnixSeconds: number;

  constructor(private readonly now: () => Date = () => new Date()) {
    this.changedAtUnixSeconds = this.currentUnixSeconds();
  }

  markExecuting(): void {
    this.transition('executing');
  }

  markIdle(): void {
    this.transition('idle');
  }

  read(): RuntimeSessionStatusSnapshot {
    return {
      state: this.state,
      changedAtUnixSeconds: this.changedAtUnixSeconds,
    };
  }

  private transition(next: RuntimeSessionStatusSnapshot['state']): void {
    if (this.state === next) {
      return;
    }
    this.state = next;
    this.changedAtUnixSeconds = this.currentUnixSeconds();
  }

  private currentUnixSeconds(): number {
    return Math.floor(this.now().getTime() / 1_000);
  }
}
