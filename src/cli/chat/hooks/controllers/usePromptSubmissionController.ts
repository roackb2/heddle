import { useCallback, useEffect, useState } from 'react';
import type { CredentialAwareModelOption } from '../../../../core/llm/model-policy.js';
import type { ReasoningEffort } from '../../../../core/llm/types.js';
import type { ConversationSessionService } from '../../../../core/chat/engine/types.js';
import type { ReasoningEffortPickerOption } from '../useChatPickers.js';
import type { ChatSession } from '../../state/types.js';
import { submitChatPrompt } from '../../submit.js';
import { buildPromptWithFileMentions } from '../../utils/file-mentions.js';
import type { ChatRuntimeConfig } from '../../utils/runtime.js';

type ActiveSessionUpdater = (updater: (session: ChatSession) => ChatSession) => void;

export function usePromptSubmissionController({
  runtime,
  activeModel,
  activeReasoningEffort,
  setActiveModel,
  setActiveReasoningEffort,
  sessions,
  recentSessions,
  activeSessionId,
  activeSession,
  apiKeyPresent,
  nextLocalId,
  setStatus,
  switchSession,
  closeSession,
  sessionService,
  refreshSessions,
  updateActiveSession,
  createSession,
  renameSession,
  listRecentSessionsMessage,
  driftEnabled,
  driftError,
  setDriftEnabled,
  executeTurn,
  executeDirectShellCommand,
  saveTuiSnapshotMessage,
  isRunning,
  pendingApproval,
  mentionableFiles,
  modelPicker,
  reasoningPicker,
  sessionPicker,
  fileMentionPicker,
  resetPickerIndexes,
}: {
  runtime: ChatRuntimeConfig;
  activeModel: string;
  activeReasoningEffort?: ReasoningEffort;
  setActiveModel: (model: string) => void;
  setActiveReasoningEffort: (effort: ReasoningEffort | undefined) => void;
  sessions: ChatSession[];
  recentSessions: ChatSession[];
  activeSessionId: string;
  activeSession?: ChatSession;
  apiKeyPresent: boolean;
  nextLocalId: () => string;
  setStatus: (value: string) => void;
  switchSession: (id: string) => void;
  closeSession: (id: string) => void;
  sessionService: ConversationSessionService;
  refreshSessions: () => void;
  updateActiveSession: ActiveSessionUpdater;
  createSession: (name?: string) => ChatSession;
  renameSession: (name: string) => void;
  listRecentSessionsMessage: string[];
  driftEnabled: boolean;
  driftError?: string;
  setDriftEnabled: (enabled: boolean) => void;
  executeTurn: (prompt: string, displayText?: string, sessionIdOverride?: string) => Promise<void>;
  executeDirectShellCommand: (rawCommand: string) => Promise<void>;
  saveTuiSnapshotMessage?: () => string;
  isRunning: boolean;
  pendingApproval: unknown;
  mentionableFiles: string[];
  modelPicker: {
    visible: boolean;
    highlighted?: CredentialAwareModelOption;
    resetIndex: () => void;
  };
  reasoningPicker: {
    visible: boolean;
    highlighted?: ReasoningEffortPickerOption;
    resetIndex: () => void;
  };
  sessionPicker: {
    visible: boolean;
    highlighted?: { id: string; name: string };
    resetIndex: () => void;
  };
  fileMentionPicker: {
    visible: boolean;
    highlighted?: string;
    selectHighlighted: (value: string) => boolean;
  };
  resetPickerIndexes: () => void;
}) {
  const [pendingSubmittedPrompt, setPendingSubmittedPrompt] = useState<string | undefined>();

  const preparePromptWithMentions = useCallback((prompt: string) => {
    const prepared = buildPromptWithFileMentions(prompt, runtime.workspaceRoot, mentionableFiles);
    return {
      prompt: prepared.runPrompt,
      displayText: prompt,
    };
  }, [mentionableFiles, runtime.workspaceRoot]);

  const appendPendingUserMessage = useCallback((prompt: string) => {
    const message = {
      id: nextLocalId(),
      role: 'user',
      text: prompt,
      isPending: true,
    } as const;

    sessionService.appendMessage(activeSessionId, message);
    refreshSessions();
  }, [activeSessionId, nextLocalId, refreshSessions, sessionService]);

  const saveTuiSnapshot = useCallback(() => {
    if (saveTuiSnapshotMessage) {
      return saveTuiSnapshotMessage();
    }

    return 'TUI snapshots are not available in this runtime.';
  }, [
    saveTuiSnapshotMessage,
  ]);

  const submitPrompt = useCallback(async (value: string, options?: { allowWhileRunning?: boolean }) => {
    const effectiveIsRunning = options?.allowWhileRunning ? false : isRunning;

    if (effectiveIsRunning && !pendingApproval) {
      setPendingSubmittedPrompt(value);
      appendPendingUserMessage(value);
      return;
    }

    if (options?.allowWhileRunning && pendingSubmittedPrompt === value) {
      // Desired shape: ConversationSessionService should own the pending-message
      // status transition once it has a named operation for that behavior.
      updateActiveSession((session) => {
        const pendingIndex = session.messages.findIndex(
          (message) => message.role === 'user' && message.text === value && message.isPending,
        );

        if (pendingIndex < 0) {
          return session;
        }

        return {
          ...session,
          messages: session.messages.map((message, index) =>
            index === pendingIndex ? { ...message, isPending: false } : message,
          ),
        };
      });
    }

    const submitArgs = {
      isRunning: effectiveIsRunning,
      activeModel,
      activeReasoningEffort,
      setActiveModel,
      setActiveReasoningEffort,
      sessions,
      recentSessions,
      activeSessionId,
      activeSession,
      apiKeyPresent,
      nextLocalId,
      setStatus,
      switchSession,
      closeSession,
      sessionService,
      refreshSessions,
      createSession,
      renameSession,
      listRecentSessionsMessage,
      driftEnabled,
      driftError,
      setDriftEnabled,
      workspaceRoot: runtime.workspaceRoot,
      stateRoot: runtime.stateRoot,
      credentialStorePath: runtime.credentialStorePath,
      providerCredentialSource: runtime.providerCredentialSource,
      preparePrompt: preparePromptWithMentions,
      executeTurn,
      executeDirectShellCommand,
      saveTuiSnapshot,
    };

    if (modelPicker.visible && modelPicker.highlighted) {
      modelPicker.resetIndex();
      if (modelPicker.highlighted.disabled) {
        return;
      }
      await submitChatPrompt({
        ...submitArgs,
        value: `/model ${modelPicker.highlighted.id}`,
      });
      return;
    }

    if (reasoningPicker.visible && reasoningPicker.highlighted) {
      reasoningPicker.resetIndex();
      if (reasoningPicker.highlighted.disabled) {
        return;
      }
      await submitChatPrompt({
        ...submitArgs,
        value: reasoningPicker.highlighted.id === 'default' ? '/reasoning default' : `/reasoning ${reasoningPicker.highlighted.id}`,
      });
      return;
    }

    if (sessionPicker.visible && sessionPicker.highlighted) {
      sessionPicker.resetIndex();
      await submitChatPrompt({
        ...submitArgs,
        value: `/session switch ${sessionPicker.highlighted.id}`,
      });
      return;
    }

    if (fileMentionPicker.visible && fileMentionPicker.highlighted) {
      fileMentionPicker.selectHighlighted(value);
      return;
    }

    resetPickerIndexes();
    await submitChatPrompt({
      ...submitArgs,
      value,
    });
  }, [
    isRunning,
    pendingApproval,
    pendingSubmittedPrompt,
    activeModel,
    activeReasoningEffort,
    setActiveModel,
    setActiveReasoningEffort,
    sessions,
    recentSessions,
    activeSessionId,
    activeSession,
    apiKeyPresent,
    nextLocalId,
    setStatus,
    switchSession,
    closeSession,
    sessionService,
    refreshSessions,
    updateActiveSession,
    createSession,
    renameSession,
    listRecentSessionsMessage,
    driftEnabled,
    driftError,
    setDriftEnabled,
    runtime.workspaceRoot,
    runtime.stateRoot,
    runtime.credentialStorePath,
    runtime.providerCredentialSource,
    preparePromptWithMentions,
    executeTurn,
    executeDirectShellCommand,
    saveTuiSnapshot,
    modelPicker,
    reasoningPicker,
    sessionPicker,
    fileMentionPicker,
    resetPickerIndexes,
    appendPendingUserMessage,
  ]);

  useEffect(() => {
    if (isRunning || pendingApproval || !pendingSubmittedPrompt) {
      return;
    }

    const queuedPrompt = pendingSubmittedPrompt;
    setPendingSubmittedPrompt(undefined);
    void submitPrompt(queuedPrompt, { allowWhileRunning: true });
  }, [isRunning, pendingApproval, pendingSubmittedPrompt, submitPrompt]);

  return {
    pendingSubmittedPrompt,
    clearPendingSubmittedPrompt: () => setPendingSubmittedPrompt(undefined),
    submitPrompt,
  };
}
