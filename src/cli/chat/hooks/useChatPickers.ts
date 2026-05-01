import { useMemo, useState } from 'react';
import { BUILT_IN_MODEL_GROUPS, filterBuiltInModels } from '../../../core/llm/openai-models.js';
import {
  buildCredentialAwareModelOption,
  credentialModeFromSource,
  type CredentialAwareModelOption,
} from '../../../core/llm/model-policy.js';
import type { ProviderCredentialSource } from '../utils/runtime.js';
import type { PromptKeyInput } from '../components/PromptInput.js';
import type { ChatSession } from '../state/types.js';
import { filterMentionableFiles, getMentionQuery, insertMentionSelection } from '../utils/file-mentions.js';

export function useChatPickers({
  draft,
  recentSessions,
  mentionableFiles,
  clearDraft,
  replaceDraft,
  providerCredentialSource,
}: {
  draft: string;
  recentSessions: ChatSession[];
  mentionableFiles: string[];
  clearDraft: () => void;
  replaceDraft: (value: string) => void;
  providerCredentialSource: ProviderCredentialSource;
}) {
  const [modelPickerIndex, setModelPickerIndex] = useState(0);
  const [sessionPickerIndex, setSessionPickerIndex] = useState(0);
  const [fileMentionPickerIndex, setFileMentionPickerIndex] = useState(0);

  const mentionQuery = getMentionQuery(draft);
  const fileMentionPickerVisible = mentionQuery !== undefined;
  const filteredMentionFiles = fileMentionPickerVisible ? filterMentionableFiles(mentionableFiles, mentionQuery) : [];
  const safeFileMentionPickerIndex = clampPickerIndex(fileMentionPickerIndex, filteredMentionFiles.length);
  const highlightedMentionFile = filteredMentionFiles[safeFileMentionPickerIndex];

  const credentialAwareModels = useMemo(() => {
    const credentialMode = credentialModeFromSource(providerCredentialSource);
    return BUILT_IN_MODEL_GROUPS.flatMap((group) => group.models).map((model) =>
      buildCredentialAwareModelOption({
        model,
        provider: model.startsWith('claude') ? 'anthropic' : 'openai',
        credentialMode,
      }),
    );
  }, [providerCredentialSource]);

  const modelPickerQuery = getModelPickerQuery(draft);
  const modelPickerVisible = modelPickerQuery !== undefined;
  const filteredModels = modelPickerVisible ? filterCredentialAwareModels(credentialAwareModels, modelPickerQuery) : [];
  const safeModelPickerIndex = clampPickerIndex(modelPickerIndex, filteredModels.length);
  const highlightedModel = filteredModels[safeModelPickerIndex];

  const sessionPickerQuery = getSessionPickerQuery(draft);
  const sessionPickerVisible = sessionPickerQuery !== undefined;
  const filteredSessions = sessionPickerVisible ? filterSessionsForPicker(recentSessions, sessionPickerQuery) : [];
  const safeSessionPickerIndex = clampPickerIndex(sessionPickerIndex, filteredSessions.length);
  const highlightedSession = filteredSessions[safeSessionPickerIndex];

  const resetPickerIndexes = () => {
    setModelPickerIndex(0);
    setSessionPickerIndex(0);
    setFileMentionPickerIndex(0);
  };

  const selectHighlightedMention = (value: string) => {
    if (!highlightedMentionFile) {
      return false;
    }

    replaceDraft(insertMentionSelection(value, highlightedMentionFile));
    setFileMentionPickerIndex(0);
    return true;
  };

  const handleSpecialKey = ({ key }: PromptKeyInput) => {
    if (modelPickerVisible) {
      return handlePickerKeys({
        key,
        itemCount: filteredModels.length,
        resetDraft: clearDraft,
        resetIndex: () => setModelPickerIndex(0),
        advance: () => setModelPickerIndex((current) => (current + 1) % filteredModels.length),
        retreat: () => setModelPickerIndex((current) => (current <= 0 ? filteredModels.length - 1 : current - 1)),
      });
    }

    if (sessionPickerVisible) {
      return handlePickerKeys({
        key,
        itemCount: filteredSessions.length,
        resetDraft: clearDraft,
        resetIndex: () => setSessionPickerIndex(0),
        advance: () => setSessionPickerIndex((current) => (current + 1) % filteredSessions.length),
        retreat: () => setSessionPickerIndex((current) => (current <= 0 ? filteredSessions.length - 1 : current - 1)),
      });
    }

    if (fileMentionPickerVisible) {
      return handlePickerKeys({
        key,
        itemCount: filteredMentionFiles.length,
        resetDraft: clearDraft,
        resetIndex: () => setFileMentionPickerIndex(0),
        advance: () => setFileMentionPickerIndex((current) => (current + 1) % filteredMentionFiles.length),
        retreat: () => setFileMentionPickerIndex((current) => (current <= 0 ? filteredMentionFiles.length - 1 : current - 1)),
      });
    }

    return false;
  };

  return {
    model: {
      query: modelPickerQuery,
      visible: modelPickerVisible,
      items: filteredModels,
      highlightedIndex: safeModelPickerIndex,
      highlighted: highlightedModel,
      resetIndex: () => setModelPickerIndex(0),
    },
    session: {
      query: sessionPickerQuery,
      visible: sessionPickerVisible,
      items: filteredSessions,
      highlightedIndex: safeSessionPickerIndex,
      highlighted: highlightedSession,
      resetIndex: () => setSessionPickerIndex(0),
    },
    fileMention: {
      query: mentionQuery,
      visible: fileMentionPickerVisible,
      items: filteredMentionFiles,
      highlightedIndex: safeFileMentionPickerIndex,
      highlighted: highlightedMentionFile,
      resetIndex: () => setFileMentionPickerIndex(0),
      selectHighlighted: selectHighlightedMention,
    },
    resetPickerIndexes,
    handleSpecialKey,
  };
}

function getModelPickerQuery(draft: string): string | undefined {
  const trimmedStart = draft.trimStart();
  if (!trimmedStart.startsWith('/model set')) {
    return undefined;
  }

  const remainder = trimmedStart.slice('/model set'.length);
  return remainder.trim();
}

function getSessionPickerQuery(draft: string): string | undefined {
  const trimmedStart = draft.trimStart();
  if (!trimmedStart.startsWith('/session choose')) {
    return undefined;
  }

  const remainder = trimmedStart.slice('/session choose'.length);
  return remainder.trim();
}

function filterCredentialAwareModels(models: CredentialAwareModelOption[], query: string): CredentialAwareModelOption[] {
  const matchingIds = new Set(filterBuiltInModels(query));
  return models.filter((model) => matchingIds.has(model.id));
}

function filterSessionsForPicker(
  sessions: Array<{ id: string; name: string }>,
  query: string,
): Array<{ id: string; name: string }> {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return sessions;
  }

  return sessions.filter(
    (session) =>
      session.id.toLowerCase().includes(normalized) ||
      session.name.toLowerCase().includes(normalized),
  );
}

function handlePickerKeys(options: {
  key: PromptKeyInput['key'];
  itemCount: number;
  resetDraft: () => void;
  resetIndex: () => void;
  advance: () => void;
  retreat: () => void;
}): boolean {
  if ((options.key.upArrow || options.key.leftArrow) && options.itemCount > 0) {
    options.retreat();
    return true;
  }

  if ((options.key.downArrow || options.key.rightArrow || options.key.tab) && options.itemCount > 0) {
    options.advance();
    return true;
  }

  if (options.key.escape) {
    options.resetDraft();
    options.resetIndex();
    return true;
  }

  return false;
}

function clampPickerIndex(index: number, itemCount: number) {
  return itemCount === 0 ? 0 : Math.min(index, Math.max(0, itemCount - 1));
}
