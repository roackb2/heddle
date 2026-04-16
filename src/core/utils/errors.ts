// ---------------------------------------------------------------------------
// Error Types
// Minimal — just enough for the loop to distinguish error kinds.
// ---------------------------------------------------------------------------

export class HeddleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HeddleError';
  }
}

export class ToolExecutionError extends HeddleError {
  constructor(
    public readonly toolName: string,
    message: string,
  ) {
    super(`Tool "${toolName}": ${message}`);
    this.name = 'ToolExecutionError';
  }
}

export class LlmError extends HeddleError {
  constructor(message: string) {
    super(message);
    this.name = 'LlmError';
  }
}

export class BudgetExhaustedError extends HeddleError {
  constructor(maxSteps: number) {
    super(`Budget exhausted after ${maxSteps} steps`);
    this.name = 'BudgetExhaustedError';
  }
}
