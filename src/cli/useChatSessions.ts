import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChatSession } from './chat-types.js';
import {
  createChatSession,
  isGenericSessionName,
  loadChatSessions,
  saveChatSessions,
  summarizeSession,
  touchSession,
} from './chat-storage.js';

type UseChatSessionsArgs = {
  sessionsFile: string;
  apiKeyPresent: boolean;
};

export function useChatSessions({ sessionsFile, apiKeyPresent }: UseChatSessionsArgs) {
  const initialSessionsRef = useRef<ChatSession[] | undefined>(undefined);
  if (!initialSessionsRef.current) {
    initialSessionsRef.current = loadChatSessions(sessionsFile, apiKeyPresent);
  }

  const nextSessionNumberRef = useRef(getNextSessionNumber(initialSessionsRef.current));
  const [sessions, setSessions] = useState<ChatSession[]>(initialSessionsRef.current);
  const [activeSessionId, setActiveSessionId] = useState(initialSessionsRef.current[0]?.id ?? 'session-1');

  useEffect(() => {
    saveChatSessions(sessionsFile, sessions);
  }, [sessionsFile, sessions]);

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
    });
    setSessions([fallback]);
    setActiveSessionId(fallback.id);
  }, [apiKeyPresent, sessions]);

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

  const updateSessionById = (sessionId: string, updater: (session: ChatSession) => ChatSession) => {
    setSessions((current) => current.map((session) => (session.id === sessionId ? touchSession(updater(session)) : session)));
  };

  const updateActiveSession = (updater: (session: ChatSession) => ChatSession) => {
    updateSessionById(activeSessionId, updater);
  };

  const createSession = (name?: string) => {
    const id = `session-${Date.now()}`;
    const nextSession = createChatSession({
      id,
      name: name?.trim() || `Session ${nextSessionNumberRef.current++}`,
      apiKeyPresent,
    });
    setSessions((current) => [touchSession(nextSession), ...current].slice(0, 24));
    setActiveSessionId(id);
    return nextSession;
  };

  const renameSession = (name: string) => {
    updateActiveSession((session) => ({ ...session, name }));
  };

  const removeSession = (id: string) => {
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
        }),
      ];
    });

    if (removedActive) {
      setActiveSessionId(nextActiveSessionId);
    }

    return removedActive;
  };

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
