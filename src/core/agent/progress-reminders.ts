// ---------------------------------------------------------------------------
// Progress reminders — nudges the agent to follow through when it starts
// drifting into planning/meta loops instead of executing or concluding.
// ---------------------------------------------------------------------------

import type { ToolCall, ToolResult } from '../types.js';
import { isWorkspaceChangeMutateCommand } from './mutation-tracking.js';
import { extractShellCommand } from './util.js';

const DRIFT_REMINDER_THRESHOLD = 6;
const LOW_STEP_REMINDER_THRESHOLD = 2;

export type ProgressReminderState = {
  successfulNonMutationToolCalls: number;
  sentDriftReminder: boolean;
  sentLowStepReminder: boolean;
};

export function createProgressReminderState(): ProgressReminderState {
  return {
    successfulNonMutationToolCalls: 0,
    sentDriftReminder: false,
    sentLowStepReminder: false,
  };
}

export function buildProgressReminders(
  state: ProgressReminderState,
  options: {
    effectiveCall: ToolCall;
    result: ToolResult;
    remainingSteps: number;
  },
): string[] {
  const reminders: string[] = [];

  if (options.result.ok) {
    if (isWorkspaceChangingCall(options.effectiveCall)) {
      state.successfulNonMutationToolCalls = 0;
      state.sentDriftReminder = false;
    } else {
      state.successfulNonMutationToolCalls += 1;
    }

    if (options.effectiveCall.tool === 'report_state') {
      reminders.push(buildReportStateReminder(options.result.output));
    }
  }

  if (!state.sentDriftReminder && state.successfulNonMutationToolCalls >= DRIFT_REMINDER_THRESHOLD) {
    state.sentDriftReminder = true;
    reminders.push(
      'Host reminder: you already have substantial evidence. Do not spend another turn rephrasing the plan. Either execute the single next bounded action that would move the task forward, or answer directly from the evidence you already have.',
    );
  }

  if (
    !state.sentLowStepReminder &&
    state.successfulNonMutationToolCalls >= 3 &&
    options.remainingSteps <= LOW_STEP_REMINDER_THRESHOLD
  ) {
    state.sentLowStepReminder = true;
    reminders.push(
      `Host reminder: only ${options.remainingSteps} step(s) remain. Do not spend another turn rephrasing the plan. Either execute the single next concrete action needed to finish the current slice, or answer with the best grounded blocker.`,
    );
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
