// ---------------------------------------------------------------------------
// Budget — simple step counter
// ---------------------------------------------------------------------------

export type Budget = {
  /** Consume one step. Returns the new remaining count. */
  step(): number;
  /** How many steps remain. */
  remaining(): number;
  /** Whether the budget has been exhausted. */
  exhausted(): boolean;
};

/**
 * Create a budget that allows up to `maxSteps` iterations.
 */
export function createBudget(maxSteps: number): Budget {
  let used = 0;

  return {
    step() {
      used++;
      return maxSteps - used;
    },
    remaining() {
      return maxSteps - used;
    },
    exhausted() {
      return used >= maxSteps;
    },
  };
}
