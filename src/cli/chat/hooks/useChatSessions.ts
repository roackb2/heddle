/**
 * CLI host session hook.
 *
 * TUI session state hook.
 *
 * Lifecycle rule:
 * create, settings, rename, delete, reset, and drift writes go through the
 * control-plane tRPC API. The local session service remains only as temporary
 * read/hydration support for the not-yet-migrated turn loop.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ControlPlaneProxyClient } from '@/client-shared/api/proxy.js';
import type { RouterInputs } from '@/client-shared/api/types.js';
import type { ChatSession } from '../state/types.js';
import { RuntimeWorkspaceService } from '@/core/runtime/workspaces/index.js';
import type { SessionExecutionPreferences } from '../../../core/chat/engine/sessions/preferences/service.js';
import { resolveNewSessionExecutionPreferences } from '../../../core/chat/engine/sessions/preferences/service.js';
import { FileConversationSessionService } from '../../../core/chat/engine/sessions/service.js';

type UseChatSessionsArgs = {
  sessionCatalogFile: string;
  apiKeyPresent: boolean;
  defaultModel: string;
  workspaceRoot: string;
  stateRoot: string;
  controlPlaneClient: ControlPlaneProxyClient;
};

export function useChatSessions({
  sessionCatalogFile,
  apiKeyPresent,
  defaultModel,
  workspaceRoot,
  stateRoot,
  controlPlaneClient,
}: UseChatSessionsArgs) {
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
        apiKeyPresent,
        workspaceId,
      }),
    [apiKeyPresent, defaultModel, sessionCatalogFile, stateRoot, workspaceId, workspaceRoot],
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
    const nextSessions = sessionService.list();
    setSessions(nextSessions);
    return nextSessions;
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

  const setSessionPreferences = useCallback(async (sessionId: string, preferences: SessionExecutionPreferences) => {
    await controlPlaneClient.controlPlane.sessionSettingsUpdate.mutate({
      id: sessionId,
      workspaceId,
      model: preferences.model,
      reasoningEffort: preferences.reasoningEffort,
    } satisfies RouterInputs['controlPlane']['sessionSettingsUpdate']);
    refreshSessions();
  }, [controlPlaneClient, refreshSessions, workspaceId]);

  const createSession = useCallback(async (name?: string, preferences?: SessionExecutionPreferences) => {
    const nextPreferences = resolveNewSessionExecutionPreferences({
      defaultModel,
      inherited: preferences,
    });
    const created = await controlPlaneClient.controlPlane.sessionCreate.mutate({
      name,
      apiKeyPresent,
      workspaceId,
      model: nextPreferences.model,
      reasoningEffort: nextPreferences.reasoningEffort,
    } satisfies RouterInputs['controlPlane']['sessionCreate']);
    const nextSession = sessionService.require(created.id);
    setSessions(sessionService.list().slice(0, 24));
    setActiveSessionId(nextSession.id);
    return nextSession;
  }, [apiKeyPresent, controlPlaneClient, defaultModel, sessionService, workspaceId]);

  const renameSession = useCallback(async (name: string) => {
    await controlPlaneClient.controlPlane.sessionRename.mutate({
      id: activeSessionId,
      workspaceId,
      name,
    } satisfies RouterInputs['controlPlane']['sessionRename']);
    refreshSessions();
  }, [activeSessionId, controlPlaneClient, refreshSessions, workspaceId]);

  const removeSession = useCallback(async (id: string) => {
    const removedActive = id === activeSessionId;
    const deleted = (await controlPlaneClient.controlPlane.sessionDelete.mutate({
      id,
      workspaceId,
    } satisfies RouterInputs['controlPlane']['sessionDelete'])).deleted;
    if (!deleted) {
      return false;
    }
    const nextSessions = sessionService.list();
    setSessions(nextSessions);

    if (removedActive) {
      setActiveSessionId(nextSessions[0]?.id ?? 'session-1');
    }

    return removedActive;
  }, [activeSessionId, controlPlaneClient, sessionService, workspaceId]);

  const resetSession = useCallback(async (id: string) => {
    await controlPlaneClient.controlPlane.sessionReset.mutate({
      id,
      workspaceId,
    } satisfies RouterInputs['controlPlane']['sessionReset']);
    refreshSessions();
  }, [controlPlaneClient, refreshSessions, workspaceId]);

  const setSessionDriftEnabled = useCallback(async (id: string, enabled: boolean) => {
    await controlPlaneClient.controlPlane.sessionSettingsUpdate.mutate({
      id,
      workspaceId,
      driftEnabled: enabled,
    } satisfies RouterInputs['controlPlane']['sessionSettingsUpdate']);
    refreshSessions();
  }, [controlPlaneClient, refreshSessions, workspaceId]);

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
    resetSession,
    setSessionDriftEnabled,
    controlPlaneClient,
    workspaceId,
  };
}
