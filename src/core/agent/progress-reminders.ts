// ---------------------------------------------------------------------------
// Progress reminders — currently inert placeholder state for future progress
// tracking that should not inject runtime steering messages.
// ---------------------------------------------------------------------------

import type { ToolCall, ToolResult } from '../types.js';

export type ProgressReminderState = {
  successfulNonMutationToolCalls: number;
};

export function createProgressReminderState(): ProgressReminderState {
  return {
    successfulNonMutationToolCalls: 0,
  };
}

export function buildProgressReminders(
  _state: ProgressReminderState,
  _options: {
    effectiveCall: ToolCall;
    result: ToolResult;
  },
): string[] {
  return [];
}
