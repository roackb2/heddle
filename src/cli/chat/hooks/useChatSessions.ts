/**
 * CLI host session hook.
 *
 * Boundary rule:
 * - this hook should be a React-facing adapter over core session services;
 * - it should not own session storage mechanics or session collection policy.
 *
 * Current compromise:
 * this hook still keeps React state for host rendering and local selection.
 * The intended long-term shape is for hosts to stay thin adapters over core
 * services while storage and session semantics remain behind the engine
 * boundary.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ChatSession } from '../state/types.js';
import { RuntimeWorkspaceService } from '@/core/runtime/workspaces/index.js';
import type { SessionExecutionPreferences } from '../../../core/chat/engine/sessions/preferences/service.js';
import { resolveNewSessionExecutionPreferences } from '../../../core/chat/engine/sessions/preferences/service.js';
import { FileConversationSessionService } from '../../../core/chat/engine/sessions/service.js';

type UseChatSessionsArgs = {
  sessionCatalogFile: string;
  defaultModel: string;
  workspaceRoot: string;
  stateRoot: string;
};

export function useChatSessions({ sessionCatalogFile, defaultModel, workspaceRoot, stateRoot }: UseChatSessionsArgs) {
  const workspaceId = useMemo(
    () => RuntimeWorkspaceService.resolveContext({ workspaceRoot, stateRoot }).activeWorkspace.id,
    [workspaceRoot, stateRoot],
  );
  const sessionService = useMemo(
    () =>
      // Desired shape: this hook should eventually receive
      // createConversationEngine(...).sessions from the host boundary. Direct
      // construction is acceptable only while TUI still lacks one shared
      // engine-facing runtime config object.
      new FileConversationSessionService({
        workspaceRoot,
        stateRoot,
        sessionStoragePath: sessionCatalogFile,
        model: defaultModel,
        workspaceId,
      }),
    [defaultModel, sessionCatalogFile, stateRoot, workspaceId, workspaceRoot],
  );
  const initialSessions = useMemo(() => sessionService.list(), [sessionService]);
  const [sessions, setSessions] = useState<ChatSession[]>(initialSessions);
  const [activeSessionId, setActiveSessionId] = useState(() => initialSessions[0]?.id ?? 'session-1');

  useEffect(() => {
    if (!sessions.some((session) => session.id === activeSessionId) && sessions[0]) {
      setActiveSessionId(sessions[0].id);
    }
  }, [activeSessionId, sessions]);

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) ?? sessions[0],
    [activeSessionId, sessions],
  );

  const recentSessions = useMemo(
    () => [...sessions].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).slice(0, 8),
    [sessions],
  );

  const activeSessionSummary = activeSession ? FileConversationSessionService.summarize(activeSession) : undefined;
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

  const refreshSessions = useCallback(() => {
    setSessions(sessionService.list());
  }, [sessionService]);

  // Migration escape hatch: keep this local and shrink callers over time.
  // New persisted session behavior should be a named ConversationSessionService
  // operation or a ConversationTurnService result, not another generic updater.
  const updateSessionById = useCallback((sessionId: string, updater: (session: ChatSession) => ChatSession) => {
    const updated = sessionService.update(sessionId, updater);
    if (!updated) {
      return;
    }

    refreshSessions();
  }, [refreshSessions, sessionService]);

  const updateActiveSession = useCallback((updater: (session: ChatSession) => ChatSession) => {
    updateSessionById(activeSessionId, updater);
  }, [activeSessionId, updateSessionById]);

  const setSessionPreferences = useCallback((sessionId: string, preferences: SessionExecutionPreferences) => {
    sessionService.updateSettings(sessionId, preferences);
    refreshSessions();
  }, [refreshSessions, sessionService]);

  const createSession = useCallback((name?: string, preferences?: SessionExecutionPreferences) => {
    const nextPreferences = resolveNewSessionExecutionPreferences({
      defaultModel,
      inherited: preferences,
    });
    const nextSession = sessionService.create({
      id: `session-${Date.now()}`,
      name,
      ...nextPreferences,
      workspaceId,
    });
    setSessions(sessionService.list().slice(0, 24));
    setActiveSessionId(nextSession.id);
    return nextSession;
  }, [defaultModel, sessionService, workspaceId]);

  const renameSession = useCallback((name: string) => {
    sessionService.rename(activeSessionId, name);
    refreshSessions();
  }, [activeSessionId, refreshSessions, sessionService]);

  const removeSession = useCallback((id: string) => {
    const removedActive = id === activeSessionId;
    const deleted = sessionService.delete(id);
    if (!deleted) {
      return false;
    }
    const nextSessions = sessionService.list();
    setSessions(nextSessions);

    if (removedActive) {
      setActiveSessionId(nextSessions[0]?.id ?? 'session-1');
    }

    return removedActive;
  }, [activeSessionId, sessionService]);

  return {
    sessions,
    sessionService,
    refreshSessions,
    activeSessionId,
    setActiveSessionId,
    activeSession,
    recentSessions,
    activeSessionSummary,
    listRecentSessionsMessage,
    updateSessionById,
    updateActiveSession,
    setSessionPreferences,
    createSession,
    renameSession,
    removeSession,
  };
}
