import type { ActionState } from './useAgentRun.js';

export function beginTuiAgentTurn(state: ActionState): AbortController {
  const abortController = beginTuiRunningAction(state);

  state.setLiveEvents([]);
  state.setCurrentEditPreview(undefined);
  state.setCurrentPlan(undefined);
  state.setCurrentAssistantText(undefined);

  return abortController;
}

export function finishTuiAgentTurn(state: ActionState) {
  finishTuiRunningAction(state);
}

export function beginTuiDirectShellAction(state: ActionState, command: string): AbortController {
  const abortController = beginTuiRunningAction(state);

  state.setLiveEvents([{ id: state.nextLocalId(), text: `running direct shell (${command})` }]);

  return abortController;
}

export function finishTuiDirectShellAction(state: ActionState) {
  state.setPendingApproval(undefined);
  state.setApprovalChoice('approve');
  finishTuiRunningAction(state);
}

function beginTuiRunningAction(state: ActionState): AbortController {
  const abortController = new AbortController();

  state.setError(undefined);
  state.setIsRunning(true);
  state.setStatus('Running');
  state.interruptRequestedRef.current = false;
  state.setInterruptRequested(false);
  state.abortControllerRef.current = abortController;

  return abortController;
}

function finishTuiRunningAction(state: ActionState) {
  state.setIsRunning(false);
  state.interruptRequestedRef.current = false;
  state.setInterruptRequested(false);
  state.abortControllerRef.current = undefined;
}
