import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChatSession } from '../state/types.js';
import {
  createChatSession,
  isGenericSessionName,
  loadChatSessions,
  saveChatSessions,
  summarizeSession,
  touchSession,
} from '../state/storage.js';
import { resolveWorkspaceContext } from '../../../core/runtime/workspaces.js';

type UseChatSessionsArgs = {
  sessionCatalogFile: string;
  apiKeyPresent: boolean;
  defaultModel: string;
  workspaceRoot: string;
  stateRoot: string;
};

export function useChatSessions({ sessionCatalogFile, apiKeyPresent, defaultModel, workspaceRoot, stateRoot }: UseChatSessionsArgs) {
  const workspaceId = useMemo(
    () => resolveWorkspaceContext({ workspaceRoot, stateRoot }).activeWorkspace.id,
    [workspaceRoot, stateRoot],
  );
  const initialSessionsRef = useRef<ChatSession[] | undefined>(undefined);
  if (!initialSessionsRef.current) {
    initialSessionsRef.current = loadChatSessions(sessionCatalogFile, apiKeyPresent).map((session) => ({
      ...session,
      model: session.model ?? defaultModel,
    }));
  }

  const nextSessionNumberRef = useRef(getNextSessionNumber(initialSessionsRef.current));
  const [sessions, setSessions] = useState<ChatSession[]>(initialSessionsRef.current);
  const [activeSessionId, setActiveSessionId] = useState(initialSessionsRef.current[0]?.id ?? 'session-1');

  useEffect(() => {
    saveChatSessions(sessionCatalogFile, sessions);
  }, [sessionCatalogFile, sessions]);

  useEffect(() => {
    if (!sessions.some((session) => session.id === activeSessionId) && sessions[0]) {
      setActiveSessionId(sessions[0].id);
    }
  }, [activeSessionId, sessions]);

  useEffect(() => {
    if (sessions.length > 0) {
      return;
    }

    const fallback = createChatSession({
      id: 'session-1',
      name: 'Session 1',
      apiKeyPresent,
      model: defaultModel,
      workspaceId,
    });
    setSessions([fallback]);
    setActiveSessionId(fallback.id);
  }, [apiKeyPresent, defaultModel, sessions, workspaceId]);

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) ?? sessions[0],
    [activeSessionId, sessions],
  );

  const recentSessions = useMemo(
    () => [...sessions].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).slice(0, 8),
    [sessions],
  );

  const activeSessionSummary = activeSession ? summarizeSession(activeSession) : undefined;
  const listRecentSessionsMessage =
    recentSessions.length > 0 ?
      [
        'Recent sessions:',
        ...recentSessions.map(
          (session, index) =>
            `${session.id === activeSessionId ? '*' : `${index + 1}.`} ${session.id} (${session.name})`,
        ),
        '',
        'Use /session switch <id> to jump to one, or /session continue <id> to switch and resume immediately.',
      ]
    : ['No saved sessions yet.'];

  const updateSessionById = useCallback((sessionId: string, updater: (session: ChatSession) => ChatSession) => {
    setSessions((current) => current.map((session) => {
      if (session.id !== sessionId) {
        return session;
      }

      const nextSession = updater(session);
      return nextSession === session ? session : touchSession(nextSession);
    }));
  }, []);

  const updateActiveSession = useCallback((updater: (session: ChatSession) => ChatSession) => {
    updateSessionById(activeSessionId, updater);
  }, [activeSessionId, updateSessionById]);

  const setSessionModel = useCallback((sessionId: string, model: string) => {
    updateSessionById(sessionId, (session) => (
      session.model === model ? session : { ...session, model }
    ));
  }, [updateSessionById]);

  const createSession = useCallback((name?: string, model = defaultModel) => {
    const id = `session-${Date.now()}`;
    const nextSession = createChatSession({
      id,
      name: name?.trim() || `Session ${nextSessionNumberRef.current++}`,
      apiKeyPresent,
      model,
      workspaceId,
    });
    setSessions((current) => [touchSession(nextSession), ...current].slice(0, 24));
    setActiveSessionId(id);
    return nextSession;
  }, [apiKeyPresent, defaultModel, workspaceId]);

  const renameSession = useCallback((name: string) => {
    updateActiveSession((session) => ({ ...session, name }));
  }, [updateActiveSession]);

  const removeSession = useCallback((id: string) => {
    const removedActive = id === activeSessionId;
    const nextActiveSessionId = sessions.find((session) => session.id !== id)?.id ?? 'session-1';

    setSessions((current) => {
      const remaining = current.filter((session) => session.id !== id);
      if (remaining.length > 0) {
        return remaining;
      }

      return [
        createChatSession({
          id: 'session-1',
          name: 'Session 1',
          apiKeyPresent,
          model: defaultModel,
          workspaceId,
        }),
      ];
    });

    if (removedActive) {
      setActiveSessionId(nextActiveSessionId);
    }

    return removedActive;
  }, [activeSessionId, apiKeyPresent, defaultModel, sessions, workspaceId]);

  return {
    sessions,
    activeSessionId,
    setActiveSessionId,
    activeSession,
    recentSessions,
    activeSessionSummary,
    listRecentSessionsMessage,
    updateSessionById,
    updateActiveSession,
    setSessionModel,
    createSession,
    renameSession,
    removeSession,
  };
}

function getNextSessionNumber(sessions: ChatSession[]): number {
  const highestGenericNumber = sessions.reduce((highest, session) => {
    if (!isGenericSessionName(session.name)) {
      return highest;
    }

    const parsed = Number.parseInt(session.name.replace(/^Session\s+/, ''), 10);
    if (!Number.isFinite(parsed)) {
      return highest;
    }

    return Math.max(highest, parsed);
  }, 0);

  return highestGenericNumber + 1;
}
