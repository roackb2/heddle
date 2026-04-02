import { useEffect, useMemo, useRef, useState } from 'react';
import { useInput } from 'ink';
import type { ActionState } from './chat-actions.js';
import type { ApprovalChoice, LiveEvent, PendingApproval } from './chat-types.js';

const WORKING_FRAMES = ['.', '..', '...'];

export function useChatRunState(nextLocalId: () => string) {
  const [status, setStatus] = useState('Idle');
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [liveEvents, setLiveEvents] = useState<LiveEvent[]>([]);
  const [workingFrame, setWorkingFrame] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | undefined>();
  const [approvalChoice, setApprovalChoice] = useState<ApprovalChoice>('approve');
  const [interruptRequested, setInterruptRequested] = useState(false);
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

      if (key.leftArrow || key.upArrow || key.tab) {
        setApprovalChoice('approve');
        return;
      }

      if (key.rightArrow || key.downArrow) {
        setApprovalChoice('deny');
        return;
      }

      if (key.return) {
        const approved = approvalChoice === 'approve';
        pendingApproval.resolve({
          approved,
          reason: approved ? 'Approved in chat UI' : 'Denied in chat UI',
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
    setLiveEvents,
    resetRunState,
    actionState,
    workingFrames: WORKING_FRAMES,
  };
}
