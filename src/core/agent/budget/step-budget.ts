/**
 * Tracks remaining model/tool loop steps for one agent run.
 */
export class AgentStepBudget {
  private used = 0;

  constructor(private readonly maxSteps: number) {}

  step(): number {
    this.used += 1;
    return this.remaining();
  }

  remaining(): number {
    return this.maxSteps - this.used;
  }

  exhausted(): boolean {
    return this.used >= this.maxSteps;
  }
}
