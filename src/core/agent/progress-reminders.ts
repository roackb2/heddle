// ---------------------------------------------------------------------------
// Progress reminders — nudges the agent to follow through when it starts
// drifting into planning/meta loops instead of executing or concluding.
// ---------------------------------------------------------------------------

import type { ToolCall, ToolResult } from '../types.js';
import { isWorkspaceChangeMutateCommand } from './mutation-tracking.js';
import { extractShellCommand } from './util.js';

export type ProgressReminderState = {
  successfulNonMutationToolCalls: number;
};

export function createProgressReminderState(): ProgressReminderState {
  return {
    successfulNonMutationToolCalls: 0,
  };
}

export function buildProgressReminders(
  state: ProgressReminderState,
  options: {
    effectiveCall: ToolCall;
    result: ToolResult;
  },
): string[] {
  const reminders: string[] = [];

  if (!options.result.ok) {
    return reminders;
  }

  if (isWorkspaceChangingCall(options.effectiveCall)) {
    state.successfulNonMutationToolCalls = 0;
  } else {
    state.successfulNonMutationToolCalls += 1;
  }

  if (options.effectiveCall.tool === 'report_state') {
    reminders.push(buildReportStateReminder(options.result.output));
  }

  return reminders;
}

function isWorkspaceChangingCall(call: ToolCall): boolean {
  if (call.tool === 'edit_file') {
    return true;
  }

  if (call.tool !== 'run_shell_mutate') {
    return false;
  }

  const command = extractShellCommand(call.input);
  return !!command && isWorkspaceChangeMutateCommand(command);
}

function buildReportStateReminder(output: unknown): string {
  const nextNeed = extractNextNeed(output);
  return nextNeed ?
      `Host reminder: report_state recorded a blocker. If that blocker is still real, do the concrete nextNeed you identified (${nextNeed}) or finish with the best grounded blocker. If you already have enough evidence to proceed, continue instead of repeating the same planning state.`
    : 'Host reminder: report_state recorded a blocker. If the blocker is still real, take the concrete next action needed to unblock progress or finish with the best grounded blocker. If progress is already available, continue instead of repeating the same planning state.';
}

function extractNextNeed(output: unknown): string | undefined {
  if (!output || typeof output !== 'object' || Array.isArray(output)) {
    return undefined;
  }

  const nextNeed = (output as { nextNeed?: unknown }).nextNeed;
  return typeof nextNeed === 'string' && nextNeed.trim() ? nextNeed.trim() : undefined;
}
