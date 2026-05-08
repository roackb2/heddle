import { useMemo, useState } from 'react';
import { BUILT_IN_MODEL_GROUPS, filterBuiltInModels } from '../../../core/llm/openai-models.js';
import {
  buildCredentialAwareModelOption,
  credentialModeFromSource,
  resolveDefaultReasoningEffort,
  supportsOpenAiRequestReasoningEffort,
  supportsReasoningEffort,
  type CredentialAwareModelOption,
} from '../../../core/llm/model-policy.js';
import type { ReasoningEffort } from '../../../core/llm/types.js';
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
  activeModel,
}: {
  draft: string;
  recentSessions: ChatSession[];
  mentionableFiles: string[];
  clearDraft: () => void;
  replaceDraft: (value: string) => void;
  providerCredentialSource: ProviderCredentialSource;
  activeModel: string;
}) {
  const [modelPickerIndex, setModelPickerIndex] = useState(0);
  const [reasoningPickerIndex, setReasoningPickerIndex] = useState(0);
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

  const reasoningPickerQuery = getReasoningPickerQuery(draft);
  const reasoningPickerVisible = reasoningPickerQuery !== undefined;
  const reasoningOptions = useMemo(() => buildReasoningEffortOptions(activeModel), [activeModel]);
  const filteredReasoningOptions = reasoningPickerVisible ? filterReasoningEffortOptions(reasoningOptions, reasoningPickerQuery) : [];
  const safeReasoningPickerIndex = clampPickerIndex(reasoningPickerIndex, filteredReasoningOptions.length);
  const highlightedReasoningEffort = filteredReasoningOptions[safeReasoningPickerIndex];

  const sessionPickerQuery = getSessionPickerQuery(draft);
  const sessionPickerVisible = sessionPickerQuery !== undefined;
  const filteredSessions = sessionPickerVisible ? filterSessionsForPicker(recentSessions, sessionPickerQuery) : [];
  const safeSessionPickerIndex = clampPickerIndex(sessionPickerIndex, filteredSessions.length);
  const highlightedSession = filteredSessions[safeSessionPickerIndex];

  const resetPickerIndexes = () => {
    setModelPickerIndex(0);
    setReasoningPickerIndex(0);
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

    if (reasoningPickerVisible) {
      return handlePickerKeys({
        key,
        itemCount: filteredReasoningOptions.length,
        resetDraft: clearDraft,
        resetIndex: () => setReasoningPickerIndex(0),
        advance: () => setReasoningPickerIndex((current) => (current + 1) % filteredReasoningOptions.length),
        retreat: () => setReasoningPickerIndex((current) => (current <= 0 ? filteredReasoningOptions.length - 1 : current - 1)),
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
    reasoning: {
      query: reasoningPickerQuery,
      visible: reasoningPickerVisible,
      items: filteredReasoningOptions,
      highlightedIndex: safeReasoningPickerIndex,
      highlighted: highlightedReasoningEffort,
      resetIndex: () => setReasoningPickerIndex(0),
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

export type ReasoningEffortPickerOption = {
  id: 'default' | ReasoningEffort;
  label: string;
  description: string;
  disabled: boolean;
  disabledReason?: string;
};

function getModelPickerQuery(draft: string): string | undefined {
  const trimmedStart = draft.trimStart();
  if (!trimmedStart.startsWith('/model set')) {
    return undefined;
  }

  const remainder = trimmedStart.slice('/model set'.length);
  return remainder.trim();
}

function getReasoningPickerQuery(draft: string): string | undefined {
  const trimmedStart = draft.trimStart();
  if (!trimmedStart.startsWith('/reasoning set')) {
    return undefined;
  }

  const remainder = trimmedStart.slice('/reasoning set'.length);
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

function buildReasoningEffortOptions(model: string): ReasoningEffortPickerOption[] {
  const requestSupported = supportsOpenAiRequestReasoningEffort(model);
  const reasoningSupported = supportsReasoningEffort(model);
  const defaultEffort = resolveDefaultReasoningEffort(model);
  const disabledReason =
    reasoningSupported ?
      'Not supported by request path'
    : 'Not supported';

  return [
    {
      id: 'default',
      label: 'default',
      description: defaultEffort ? `Use ${model} default (${defaultEffort})` : `Do not send reasoning effort for ${model}`,
      disabled: false,
    },
    ...(['low', 'medium', 'high'] as const).map((effort) => ({
      id: effort,
      label: effort,
      description: `Set explicit ${effort} effort`,
      disabled: !requestSupported,
      disabledReason: requestSupported ? undefined : disabledReason,
    })),
    {
      id: 'ultrahigh' as const,
      label: 'ultrahigh',
      description: 'Reserved; not accepted by current OpenAI requests',
      disabled: true,
      disabledReason: 'Reserved',
    },
  ];
}

function filterReasoningEffortOptions(
  options: ReasoningEffortPickerOption[],
  query: string,
): ReasoningEffortPickerOption[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return options;
  }

  return options.filter((option) =>
    option.id.toLowerCase().includes(normalized)
    || option.label.toLowerCase().includes(normalized)
    || option.description.toLowerCase().includes(normalized),
  );
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
