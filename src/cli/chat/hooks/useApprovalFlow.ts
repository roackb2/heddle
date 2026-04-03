import { useEffect, useMemo, useRef, useState } from 'react';
import { useInput } from 'ink';
import type { ActionState } from './useAgentRun.js';
import type { ApprovalChoice, LiveEvent, PendingApproval } from '../state/types.js';
import type { EditFilePreview } from '../../../tools/edit-file.js';
import type { PlanItem } from '../../../tools/update-plan.js';

const WORKING_FRAMES = ['.', '..', '...'];
const APPROVAL_CHOICES: ApprovalChoice[] = ['approve', 'allow_project', 'deny'];

export function useApprovalFlow(nextLocalId: () => string) {
  const [status, setStatus] = useState('Idle');
  const [isRunning, setIsRunning] = useState(false);
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
        setApprovalChoice((current) => cycleApprovalChoice(current, -1));
        return;
      }

      if (key.rightArrow || key.downArrow || key.tab) {
        setApprovalChoice((current) => cycleApprovalChoice(current, 1));
        return;
      }

      if (key.return) {
        const approved = approvalChoice !== 'deny';
        if (approvalChoice === 'allow_project') {
          pendingApproval.rememberForProject?.();
        }
        pendingApproval.resolve({
          approved,
          reason:
            approvalChoice === 'allow_project' ? 'Approved and remembered for this project in chat UI'
            : approved ? 'Approved in chat UI'
            : 'Denied in chat UI',
        });
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
        setApprovalChoice('allow_project');
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

  const resetRunState = (options?: { abortInFlight?: boolean; clearError?: boolean }) => {
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
  };

  const actionState = useMemo<ActionState>(
    () => ({
      isRunning,
      nextLocalId,
      setError,
      setStatus,
      setIsRunning,
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

function cycleApprovalChoice(current: ApprovalChoice, direction: -1 | 1): ApprovalChoice {
  const index = APPROVAL_CHOICES.indexOf(current);
  const nextIndex = (index + direction + APPROVAL_CHOICES.length) % APPROVAL_CHOICES.length;
  return APPROVAL_CHOICES[nextIndex] ?? 'approve';
}
