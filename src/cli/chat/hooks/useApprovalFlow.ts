import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useInput } from 'ink';
import type { ActionState } from './useAgentRun.js';
import type { ApprovalChoice, LiveEvent, PendingApproval } from '../state/types.js';
import type { EditFilePreview } from '../../../core/tools/toolkits/coding-files/edit-file.js';
import type { PlanItem } from '../../../core/tools/toolkits/internal/update-plan.js';
import { canRememberPendingApproval } from '../utils/format.js';

const WORKING_FRAMES = ['.', '..', '...'];
const BASE_APPROVAL_CHOICES: ApprovalChoice[] = ['approve', 'allow_project', 'deny'];

export function useApprovalFlow(nextLocalId: () => string) {
  const [status, setStatus] = useState('Idle');
  const [isRunning, setIsRunning] = useState(false);
  const [isMemoryUpdating, setIsMemoryUpdating] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [liveEvents, setLiveEvents] = useState<LiveEvent[]>([]);
  const [workingFrame, setWorkingFrame] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | undefined>();
  const [approvalChoice, setApprovalChoice] = useState<ApprovalChoice>('approve');
  const [interruptRequested, setInterruptRequested] = useState(false);
  const [currentEditPreview, setCurrentEditPreview] = useState<EditFilePreview | undefined>();
  const [currentPlan, setCurrentPlan] = useState<{ explanation?: string; items: PlanItem[] } | undefined>();
  const [currentAssistantText, setCurrentAssistantText] = useState<string | undefined>();
  const interruptRequestedRef = useRef(false);
  const abortControllerRef = useRef<AbortController | undefined>(undefined);

  useInput(
    (input, key) => {
      if (!pendingApproval) {
        if (isRunning && key.escape) {
          interruptRequestedRef.current = true;
          setInterruptRequested(true);
          abortControllerRef.current?.abort();
        }
        return;
      }

      if (key.leftArrow || key.upArrow) {
        setApprovalChoice((current) => cycleApprovalChoice(current, -1, pendingApproval));
        return;
      }

      if (key.rightArrow || key.downArrow || key.tab) {
        setApprovalChoice((current) => cycleApprovalChoice(current, 1, pendingApproval));
        return;
      }

      if (key.return) {
        const decision = resolveApprovalDecision(approvalChoice, pendingApproval);
        pendingApproval.resolve(decision);
        setPendingApproval(undefined);
        setApprovalChoice('approve');
        return;
      }

      const normalized = input.toLowerCase();
      if (normalized === 'y') {
        setApprovalChoice('approve');
        return;
      }

      if (normalized === 'a') {
        if (canRememberPendingApproval(pendingApproval)) {
          setApprovalChoice('allow_project');
        }
        return;
      }

      if (normalized === 'n') {
        setApprovalChoice('deny');
        return;
      }

      if (key.escape) {
        pendingApproval.resolve({ approved: false, reason: 'Denied in chat UI' });
        setPendingApproval(undefined);
        setApprovalChoice('approve');
      }
    },
    { isActive: Boolean(pendingApproval) || isRunning },
  );

  useEffect(() => {
    if (!isRunning) {
      setWorkingFrame(0);
      setElapsedSeconds(0);
      return;
    }

    const startedAt = Date.now();
    const timer = setInterval(() => {
      setWorkingFrame((current) => (current + 1) % WORKING_FRAMES.length);
      setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 300);

    return () => clearInterval(timer);
  }, [isRunning]);

  const resetRunState = useCallback((options?: { abortInFlight?: boolean; clearError?: boolean }) => {
    if (options?.abortInFlight) {
      abortControllerRef.current?.abort();
    }

    setStatus('Idle');
    if (options?.clearError !== false) {
      setError(undefined);
    }
    setLiveEvents([]);
    setPendingApproval(undefined);
    setApprovalChoice('approve');
    setInterruptRequested(false);
    setCurrentEditPreview(undefined);
    setCurrentPlan(undefined);
    setCurrentAssistantText(undefined);
    interruptRequestedRef.current = false;
    abortControllerRef.current = undefined;
    setIsRunning(false);
  }, []);

  const actionState = useMemo<ActionState>(
    () => ({
      isRunning,
      nextLocalId,
      setError,
      setStatus,
      setIsRunning,
      setIsMemoryUpdating,
      setInterruptRequested,
      setLiveEvents,
      setPendingApproval,
      setApprovalChoice,
      setCurrentEditPreview,
      setCurrentPlan,
      setCurrentAssistantText,
      interruptRequestedRef,
      abortControllerRef,
    }),
    [isRunning, nextLocalId],
  );

  return {
    status,
    setStatus,
    isRunning,
    isMemoryUpdating,
    error,
    setError,
    liveEvents,
    workingFrame,
    elapsedSeconds,
    pendingApproval,
    approvalChoice,
    interruptRequested,
    currentEditPreview,
    currentPlan,
    currentAssistantText,
    setLiveEvents,
    resetRunState,
    actionState,
    workingFrames: WORKING_FRAMES,
  };
}

export function resolveAvailableApprovalChoices(pendingApproval: PendingApproval): ApprovalChoice[] {
  return canRememberPendingApproval(pendingApproval)
    ? BASE_APPROVAL_CHOICES
    : BASE_APPROVAL_CHOICES.filter((choice) => choice !== 'allow_project');
}

export function cycleApprovalChoice(
  current: ApprovalChoice,
  direction: -1 | 1,
  pendingApproval: PendingApproval,
): ApprovalChoice {
  const choices = resolveAvailableApprovalChoices(pendingApproval);
  const index = choices.indexOf(current);
  const safeIndex = index >= 0 ? index : 0;
  const nextIndex = (safeIndex + direction + choices.length) % choices.length;
  return choices[nextIndex] ?? 'approve';
}

export function resolveApprovalDecision(
  choice: ApprovalChoice,
  pendingApproval: PendingApproval,
): { approved: boolean; reason?: string } {
  if (choice === 'allow_project' && canRememberPendingApproval(pendingApproval)) {
    pendingApproval.rememberForProject?.();
    return {
      approved: true,
      reason: 'Approved and remembered for this project in chat UI',
    };
  }

  if (choice === 'deny') {
    return {
      approved: false,
      reason: 'Denied in chat UI',
    };
  }

  return {
    approved: true,
    reason: 'Approved in chat UI',
  };
}
