import { useCallback, useEffect, useMemo, useRef } from 'react';
import { ModelCatalogService, ModelPolicyService } from '../../../../core/llm/models/index.js';
import {
  resolveNewSessionExecutionPreferences,
  resolveStoredSessionExecutionPreferences,
} from '../../../../core/chat/engine/sessions/preferences/service.js';
import { ConversationCompactionService } from '../../state/compaction.js';
import { useChatSessions } from '../useChatSessions.js';
import {
  resolveProviderCredentialSourceForModel,
  type ChatRuntimeConfig,
} from '../../utils/runtime.js';

export function useChatAppController({
  runtime,
  setStatus,
}: {
  runtime: ChatRuntimeConfig;
  setStatus: (value: string) => void;
}) {
  const {
    sessions,
    sessionService,
    refreshSessions,
    activeSessionId,
    setActiveSessionId,
    activeSession,
    recentSessions,
    listRecentSessionsMessage,
    updateSessionById,
    updateActiveSession,
    setSessionPreferences,
    createSession: createSessionWithDefaultModel,
    renameSession,
    removeSession,
  } = useChatSessions({
    sessionCatalogFile: runtime.sessionCatalogFile,
    defaultModel: runtime.model,
    workspaceRoot: runtime.workspaceRoot,
    stateRoot: runtime.stateRoot,
  });

  const storedActivePreferences = useMemo(
    () =>
      resolveStoredSessionExecutionPreferences({
        stored: activeSession,
        defaultModel: runtime.model,
      }),
    [activeSession, runtime.model],
  );

  const initialModelCompatibility = useMemo(
    () =>
      ModelPolicyService.resolveCompatibleActiveModel({
        activeModel: runtime.model,
        provider: runtime.model.startsWith('claude') ? 'anthropic' : 'openai',
        credentialMode: ModelPolicyService.credentialModeFromSource(runtime.providerCredentialSource),
      }),
    [runtime.model, runtime.providerCredentialSource],
  );

  const activeModelCompatibility = useMemo(
    () =>
      ModelPolicyService.resolveCompatibleActiveModel({
        activeModel: storedActivePreferences.model,
        provider: storedActivePreferences.model.startsWith('claude')
          ? 'anthropic'
          : 'openai',
        credentialMode: ModelPolicyService.credentialModeFromSource(
          resolveProviderCredentialSourceForModel(storedActivePreferences.model, runtime),
        ),
      }),
    [runtime, storedActivePreferences.model],
  );

  const activeModel = activeModelCompatibility.model;
  const activeReasoningEffort = activeSession?.reasoningEffort;
  const modelCompatibilityNotice =
    activeModelCompatibility.warning ?? initialModelCompatibility.warning;

  const sessionTitleModel = ModelPolicyService.resolveSystemSelectedModel({
    purpose: 'session-title',
    provider: 'openai',
    activeModel,
    credentialMode: ModelPolicyService.credentialModeFromSource(runtime.providerCredentialSource),
  });

  const createSession = useCallback(
    (name?: string) =>
      createSessionWithDefaultModel(
        name,
        resolveNewSessionExecutionPreferences({
          defaultModel: runtime.model,
          inherited: {
            model: activeModel,
            reasoningEffort: activeSession?.reasoningEffort,
          },
        }),
      ),
    [
      activeModel,
      activeSession?.reasoningEffort,
      createSessionWithDefaultModel,
      runtime.model,
    ],
  );

  const applyActiveModel = useCallback(
    (model: string) => {
      if (!activeSession) {
        return;
      }

      setSessionPreferences(activeSession.id, {
        model,
        reasoningEffort: activeSession.reasoningEffort,
      });
    },
    [activeSession, setSessionPreferences],
  );

  const applyActiveReasoningEffort = useCallback(
    (reasoningEffort: typeof activeReasoningEffort) => {
      if (!activeSession) {
        return;
      }

      setSessionPreferences(activeSession.id, {
        model: activeSession.model ?? runtime.model,
        reasoningEffort,
      });
    },
    [activeSession, runtime.model, setSessionPreferences],
  );

  useEffect(() => {
    if (!activeSession || !activeSession.model) {
      return;
    }

    if (activeSession.model === activeModel) {
      return;
    }

    setSessionPreferences(activeSession.id, {
      model: activeModel,
      reasoningEffort: activeSession.reasoningEffort,
    });
  }, [activeModel, activeSession, setSessionPreferences]);

  const previousActiveModelRef = useRef(activeModel);
  const previousActiveSessionIdRef = useRef<string | undefined>(activeSession?.id);

  useEffect(() => {
    if (!activeSession) {
      previousActiveModelRef.current = activeModel;
      previousActiveSessionIdRef.current = undefined;
      return;
    }

    const previousSessionId = previousActiveSessionIdRef.current;
    const previousModel = previousActiveModelRef.current;
    previousActiveSessionIdRef.current = activeSession.id;
    previousActiveModelRef.current = activeModel;

    if (previousSessionId !== activeSession.id || previousModel === activeModel) {
      return;
    }

    const previousWindow = ModelCatalogService.estimateBuiltInContextWindow(previousModel);
    const nextWindow = ModelCatalogService.estimateBuiltInContextWindow(activeModel);
    if (!nextWindow || (previousWindow !== undefined && nextWindow >= previousWindow)) {
      return;
    }

    const sessionId = activeSession.id;
    const sessionHistory = activeSession.history;
    const previousContext = activeSession.context;
    const previousArchives = activeSession.archives;

    setStatus('Compacting');
    sessionService.markCompactionRunning(sessionId, { sourceHistory: sessionHistory });
    refreshSessions();

    void ConversationCompactionService.compact({
      history: sessionHistory,
      runtime: {
        model: activeModel,
        stateRoot: runtime.stateRoot,
        systemContext: runtime.systemContext,
      },
      session: activeSession,
      request: {
        goal: `Model switched from ${previousModel} to ${activeModel}`,
      },
      summarizer: { credentialSource: runtime.providerCredentialSource },
    })
      .then((compacted) => {
        sessionService.applyCompactionResult(sessionId, compacted);
        refreshSessions();
        setStatus('Idle');
      })
      .catch(() => {
        sessionService.restoreCompactionState(sessionId, {
          context: previousContext,
          archives: previousArchives,
        });
        refreshSessions();
        setStatus('Idle');
      });
  }, [
    activeModel,
    activeSession,
    runtime.providerCredentialSource,
    runtime.stateRoot,
    runtime.systemContext,
    setStatus,
    sessionService,
    refreshSessions,
  ]);

  return {
    sessions,
    sessionService,
    refreshSessions,
    activeSessionId,
    setActiveSessionId,
    activeSession,
    recentSessions,
    listRecentSessionsMessage,
    updateSessionById,
    updateActiveSession,
    createSession,
    renameSession,
    removeSession,
    activeModel,
    activeReasoningEffort,
    sessionTitleModel,
    modelCompatibilityNotice,
    applyActiveModel,
    applyActiveReasoningEffort,
  };
}
