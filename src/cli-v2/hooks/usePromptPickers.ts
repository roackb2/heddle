import { useCallback, useEffect, useState } from 'react';
import type { PromptInputKey } from '../components/PromptInput.js';
import { CliV2PickerService } from '../services/pickers/index.js';
import type { ControlPlaneSessionStoreSnapshot } from '../state/control-plane-session-store.js';
import type { ControlPlanePermissionMode } from '@/client-shared/api/types.js';

export function usePromptPickers({
  draft,
  snapshot,
  clearDraft,
  onSelectModel,
  onSelectReasoning,
  onSelectPermissionMode,
  onSelectSession,
}: {
  draft: string;
  snapshot: ControlPlaneSessionStoreSnapshot;
  clearDraft: () => void;
  onSelectModel: (model: string) => void;
  onSelectReasoning: (reasoningEffort: string) => void;
  onSelectPermissionMode: (mode: ControlPlanePermissionMode) => void;
  onSelectSession: (sessionId: string) => void;
}) {
  const [modelIndex, setModelIndex] = useState(0);
  const [reasoningIndex, setReasoningIndex] = useState(0);
  const [permissionModeIndex, setPermissionModeIndex] = useState(0);
  const [sessionIndex, setSessionIndex] = useState(0);

  const modelQuery = CliV2PickerService.modelQuery(draft);
  const reasoningQuery = CliV2PickerService.reasoningQuery(draft);
  const permissionModeQuery = CliV2PickerService.permissionModeQuery(draft);
  const sessionQuery = CliV2PickerService.sessionQuery(draft);
  const modelItems = CliV2PickerService.filterModels(snapshot.modelOptions, modelQuery);
  const reasoningItems = CliV2PickerService.filterReasoningOptions(snapshot.runtimeContext, reasoningQuery);
  const permissionModeItems = CliV2PickerService.filterPermissionModes(snapshot.runtimeContext, permissionModeQuery);
  const sessionItems = CliV2PickerService.filterSessions(snapshot.sessions, sessionQuery);
  const modelHighlightedIndex = CliV2PickerService.clampIndex(modelIndex, modelItems.length);
  const reasoningHighlightedIndex = CliV2PickerService.clampIndex(reasoningIndex, reasoningItems.length);
  const permissionModeHighlightedIndex = CliV2PickerService.clampIndex(permissionModeIndex, permissionModeItems.length);
  const sessionHighlightedIndex = CliV2PickerService.clampIndex(sessionIndex, sessionItems.length);

  useEffect(() => {
    setModelIndex(0);
  }, [modelQuery]);

  useEffect(() => {
    setReasoningIndex(0);
  }, [reasoningQuery]);

  useEffect(() => {
    setPermissionModeIndex(CliV2PickerService.permissionModeInitialIndex(
      snapshot.runtimeContext,
      permissionModeQuery,
    ));
  }, [permissionModeQuery, snapshot.runtimeContext]);

  useEffect(() => {
    setSessionIndex(0);
  }, [sessionQuery]);

  const handleSpecialKey = useCallback((_input: string, key: PromptInputKey) => {
    if (modelQuery !== undefined) {
      return handlePickerKey({
        key,
        itemCount: modelItems.length,
        clearDraft,
        resetIndex: () => setModelIndex(0),
        advance: () => setModelIndex((current) => CliV2PickerService.nextIndex(current, modelItems.length)),
        retreat: () => setModelIndex((current) => CliV2PickerService.previousIndex(current, modelItems.length)),
      });
    }

    if (reasoningQuery !== undefined) {
      return handlePickerKey({
        key,
        itemCount: reasoningItems.length,
        clearDraft,
        resetIndex: () => setReasoningIndex(0),
        advance: () => setReasoningIndex((current) => CliV2PickerService.nextIndex(current, reasoningItems.length)),
        retreat: () => setReasoningIndex((current) => CliV2PickerService.previousIndex(current, reasoningItems.length)),
      });
    }

    if (sessionQuery !== undefined) {
      return handlePickerKey({
        key,
        itemCount: sessionItems.length,
        clearDraft,
        resetIndex: () => setSessionIndex(0),
        advance: () => setSessionIndex((current) => CliV2PickerService.nextIndex(current, sessionItems.length)),
        retreat: () => setSessionIndex((current) => CliV2PickerService.previousIndex(current, sessionItems.length)),
      });
    }

    if (permissionModeQuery !== undefined) {
      return handlePickerKey({
        key,
        itemCount: permissionModeItems.length,
        clearDraft,
        resetIndex: () => setPermissionModeIndex(0),
        advance: () => setPermissionModeIndex((current) => CliV2PickerService.nextIndex(current, permissionModeItems.length)),
        retreat: () => setPermissionModeIndex((current) => CliV2PickerService.previousIndex(current, permissionModeItems.length)),
      });
    }

    return false;
  }, [
    clearDraft,
    modelItems.length,
    modelQuery,
    reasoningItems.length,
    reasoningQuery,
    permissionModeItems.length,
    permissionModeQuery,
    sessionItems.length,
    sessionQuery,
  ]);

  const submitSelection = useCallback(() => {
    const highlightedModel = modelItems[modelHighlightedIndex];
    if (modelQuery !== undefined && highlightedModel) {
      if (highlightedModel.disabled) {
        return true;
      }

      clearDraft();
      setModelIndex(0);
      onSelectModel(highlightedModel.id);
      return true;
    }

    const highlightedReasoning = reasoningItems[reasoningHighlightedIndex];
    if (reasoningQuery !== undefined && highlightedReasoning) {
      if (highlightedReasoning.disabled) {
        return true;
      }

      clearDraft();
      setReasoningIndex(0);
      onSelectReasoning(highlightedReasoning.id);
      return true;
    }

    const highlightedSession = sessionItems[sessionHighlightedIndex];
    if (sessionQuery !== undefined && highlightedSession) {
      clearDraft();
      setSessionIndex(0);
      onSelectSession(highlightedSession.id);
      return true;
    }

    const highlightedPermissionMode = permissionModeItems[permissionModeHighlightedIndex];
    if (permissionModeQuery !== undefined && highlightedPermissionMode) {
      if (highlightedPermissionMode.disabled) {
        return true;
      }

      clearDraft();
      setPermissionModeIndex(0);
      onSelectPermissionMode(highlightedPermissionMode.id);
      return true;
    }

    return false;
  }, [
    clearDraft,
    modelHighlightedIndex,
    modelItems,
    modelQuery,
    onSelectModel,
    onSelectPermissionMode,
    onSelectReasoning,
    onSelectSession,
    permissionModeHighlightedIndex,
    permissionModeItems,
    permissionModeQuery,
    reasoningHighlightedIndex,
    reasoningItems,
    reasoningQuery,
    sessionHighlightedIndex,
    sessionItems,
    sessionQuery,
  ]);

  return {
    model: {
      query: modelQuery,
      items: modelItems,
      highlightedIndex: modelHighlightedIndex,
      highlighted: modelItems[modelHighlightedIndex],
      resetIndex: () => setModelIndex(0),
    },
    reasoning: {
      query: reasoningQuery,
      items: reasoningItems,
      highlightedIndex: reasoningHighlightedIndex,
      highlighted: reasoningItems[reasoningHighlightedIndex],
      resetIndex: () => setReasoningIndex(0),
    },
    permissionMode: {
      query: permissionModeQuery,
      items: permissionModeItems,
      highlightedIndex: permissionModeHighlightedIndex,
      highlighted: permissionModeItems[permissionModeHighlightedIndex],
      resetIndex: () => setPermissionModeIndex(0),
    },
    session: {
      query: sessionQuery,
      items: sessionItems,
      highlightedIndex: sessionHighlightedIndex,
      highlighted: sessionItems[sessionHighlightedIndex],
      resetIndex: () => setSessionIndex(0),
    },
    visible: modelQuery !== undefined || reasoningQuery !== undefined || permissionModeQuery !== undefined || sessionQuery !== undefined,
    handleSpecialKey,
    submitSelection,
  };
}

function handlePickerKey({
  key,
  itemCount,
  clearDraft,
  resetIndex,
  advance,
  retreat,
}: {
  key: PromptInputKey;
  itemCount: number;
  clearDraft: () => void;
  resetIndex: () => void;
  advance: () => void;
  retreat: () => void;
}): boolean {
  if ((key.upArrow || key.leftArrow) && itemCount > 0) {
    retreat();
    return true;
  }

  if ((key.downArrow || key.rightArrow || key.tab) && itemCount > 0) {
    advance();
    return true;
  }

  if (key.escape) {
    clearDraft();
    resetIndex();
    return true;
  }

  return false;
}
