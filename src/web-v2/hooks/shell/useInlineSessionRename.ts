import { useCallback, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import type { ControlPlaneState } from '@web/api/client';

export type InlineSessionRenameDraft = {
  id: string;
  name: string;
};

type UseInlineSessionRenameArgs = {
  emptyNameError: string;
  onRenameSession: (sessionId: string, name: string) => Promise<void>;
  sessions: ControlPlaneState['sessions'];
};

export function useInlineSessionRename({
  emptyNameError,
  onRenameSession,
  sessions,
}: UseInlineSessionRenameArgs) {
  const sessionsById = useMemo(
    () => new Map(sessions.map((session) => [session.id, session])),
    [sessions],
  );
  const submittingRef = useRef(false);
  const [renamingSession, setRenamingSession] = useState<InlineSessionRenameDraft>();
  const [renameError, setRenameError] = useState<string>();
  const [renameSubmitting, setRenameSubmitting] = useState(false);

  const startRename = useCallback((session: ControlPlaneState['sessions'][number]) => {
    setRenameError(undefined);
    setRenamingSession({ id: session.id, name: session.name });
  }, []);

  const cancelRename = useCallback(() => {
    if (submittingRef.current) {
      return;
    }

    setRenamingSession(undefined);
    setRenameError(undefined);
  }, []);

  const updateRenamingSessionName = useCallback((name: string) => {
    setRenamingSession((current) => current ? { ...current, name } : current);
  }, []);

  const submitRename = useCallback(async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();

    if (!renamingSession || submittingRef.current) {
      return;
    }

    const name = renamingSession.name.trim();
    const originalName = sessionsById.get(renamingSession.id)?.name;
    if (!name) {
      setRenameError(emptyNameError);
      return;
    }
    if (name === originalName) {
      setRenamingSession(undefined);
      setRenameError(undefined);
      return;
    }

    submittingRef.current = true;
    setRenameError(undefined);
    setRenameSubmitting(true);
    try {
      await onRenameSession(renamingSession.id, name);
      setRenamingSession(undefined);
    } catch (error) {
      setRenameError(error instanceof Error ? error.message : String(error));
    } finally {
      submittingRef.current = false;
      setRenameSubmitting(false);
    }
  }, [emptyNameError, onRenameSession, renamingSession, sessionsById]);

  const handleRenameKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelRename();
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      void submitRename();
    }
  }, [cancelRename, submitRename]);

  return {
    handleRenameKeyDown,
    renameError,
    renameSubmitting,
    renamingSession,
    startRename,
    submitRename,
    updateRenamingSessionName,
  };
}
