import React, { useCallback } from 'react';
import { DirectShellModeHintPanel } from './DirectShellModeHintPanel.js';
import { FileMentionPickerPanel } from './FileMentionPickerPanel.js';
import { ModelPickerPanel } from './ModelPickerPanel.js';
import { PermissionModePickerPanel } from './PermissionModePickerPanel.js';
import { PromptInput } from './PromptInput.js';
import { ReasoningEffortPickerPanel } from './ReasoningEffortPickerPanel.js';
import { SessionPickerPanel } from './SessionPickerPanel.js';
import { SlashCommandHintPanel } from './SlashCommandHintPanel.js';
import { useFileMentionPicker } from '../hooks/useFileMentionPicker.js';
import { usePromptDraft } from '../hooks/usePromptDraft.js';
import { usePromptPickers } from '../hooks/usePromptPickers.js';
import { ClientSharedPromptInputService } from '@/client-shared/services/prompt-input/index.js';
import { SlashCommandAutocompleteService } from '../services/slash-commands/index.js';
import type {
  ControlPlaneSessionStore,
  ControlPlaneSessionStoreSnapshot,
} from '../state/control-plane-session-store.js';
import type { ControlPlaneSlashCommandHint } from '@/client-shared/api/types.js';
import type { PromptInputKey } from './PromptInput.js';

type ComposerPanelProps = {
  store: ControlPlaneSessionStore;
  snapshot: ControlPlaneSessionStoreSnapshot;
  keyboardDisabled?: boolean;
  localSlashCommandHints?: ControlPlaneSlashCommandHint[];
  onLocalSlashCommand?: (command: string) => boolean;
  onSpecialKey?: (input: string, key: PromptInputKey, draft: string) => boolean;
};

/**
 * Owns the terminal composer interaction boundary.
 *
 * Prompt drafts, history, completions, and picker input are TUI-local state.
 * Keeping them here prevents each keystroke from invalidating the transcript,
 * markdown renderer, diff review panel, and other expensive session surfaces.
 * Domain behavior still belongs to the control-plane API/store.
 */
export const ComposerPanel = React.memo(function ComposerPanel({
  store,
  snapshot,
  keyboardDisabled = false,
  localSlashCommandHints = [],
  onLocalSlashCommand,
  onSpecialKey,
}: ComposerPanelProps) {
  const {
    draft,
    cursor,
    setDraft,
    setDraftState,
    clearDraft,
    recordSubmittedPrompt,
    navigateHistory,
    undoPromptEdit,
    redoPromptEdit,
  } = usePromptDraft();
  const submitDisabled = snapshot.loading || snapshot.submitting || Boolean(snapshot.pendingDirectShellConfirmation);
  const inputDisabled = snapshot.loading || Boolean(snapshot.pendingDirectShellConfirmation) || Boolean(snapshot.pendingApproval);
  const slashCommandHints = [
    ...SlashCommandAutocompleteService.filterHints(draft, localSlashCommandHints, { fallback: false }),
    ...store.getSlashCommandHints(draft),
  ];
  const directShellDraft = ClientSharedPromptInputService.parseDirectShellDraft(draft);
  const pickers = usePromptPickers({
    draft,
    snapshot,
    clearDraft,
    onSelectModel: (model) => {
      void store.selectModelFromPicker(model);
    },
    onSelectReasoning: (reasoningEffort) => {
      void store.selectReasoningFromPicker(reasoningEffort);
    },
    onSelectPermissionMode: (mode) => {
      void store.selectPermissionModeFromPicker(mode);
    },
    onSelectSession: (sessionId) => {
      void store.selectSessionFromPicker(sessionId);
    },
  });
  const fileMentions = useFileMentionPicker({
    draft,
    setDraft,
    snapshot,
    store,
  });

  const submitPrompt = useCallback((value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }

    if (pickers.submitSelection()) {
      return;
    }

    if (submitDisabled) {
      return;
    }

    clearDraft();
    if (onLocalSlashCommand?.(trimmed)) {
      return;
    }

    if (!trimmed.startsWith('/')) {
      recordSubmittedPrompt(trimmed);
    }
    void store.submitPrompt(value);
  }, [
    clearDraft,
    onLocalSlashCommand,
    pickers,
    recordSubmittedPrompt,
    store,
    submitDisabled,
  ]);

  return (
    <>
      {pickers.model.query !== undefined ? (
        <ModelPickerPanel
          query={pickers.model.query}
          models={pickers.model.items}
          activeModel={snapshot.runtimeContext?.model}
          highlightedIndex={pickers.model.highlightedIndex}
        />
      ) : null}
      {pickers.reasoning.query !== undefined ? (
        <ReasoningEffortPickerPanel
          query={pickers.reasoning.query}
          options={pickers.reasoning.items}
          activeReasoningEffort={snapshot.runtimeContext?.reasoningEffort}
          highlightedIndex={pickers.reasoning.highlightedIndex}
        />
      ) : null}
      {pickers.permissionMode.query !== undefined ? (
        <PermissionModePickerPanel
          query={pickers.permissionMode.query}
          options={pickers.permissionMode.items}
          activePermissionMode={snapshot.runtimeContext?.permissionMode}
          highlightedIndex={pickers.permissionMode.highlightedIndex}
        />
      ) : null}
      {pickers.session.query !== undefined ? (
        <SessionPickerPanel
          query={pickers.session.query}
          sessions={pickers.session.items}
          activeSessionId={snapshot.activeSessionId}
          highlightedIndex={pickers.session.highlightedIndex}
        />
      ) : null}
      {fileMentions.visible ? (
        <FileMentionPickerPanel
          query={fileMentions.query}
          suggestions={fileMentions.suggestions}
          highlightedIndex={fileMentions.highlightedIndex}
          loading={fileMentions.loading}
          error={fileMentions.error}
        />
      ) : null}
      {!pickers.visible && !fileMentions.visible ? <SlashCommandHintPanel hints={slashCommandHints} /> : null}
      {directShellDraft && !snapshot.pendingDirectShellConfirmation ? (
        <DirectShellModeHintPanel command={directShellDraft.command} />
      ) : null}
      <PromptInput
        disabled={inputDisabled || keyboardDisabled}
        submitDisabled={shouldDisablePromptInputSubmit({
          keyboardDisabled,
          pickerVisible: pickers.visible,
          submitDisabled,
        })}
        placeholder={resolvePromptPlaceholder(snapshot)}
        value={draft}
        cursor={cursor}
        onChange={setDraftState}
        onSubmit={submitPrompt}
        onComplete={(value) => (
          SlashCommandAutocompleteService.complete(value, [
            ...SlashCommandAutocompleteService.filterHints(value, localSlashCommandHints, { fallback: false }),
            ...store.getSlashCommandHints(value),
          ]) ?? store.completeSlashCommandDraft(value)
        )}
        onHistory={navigateHistory}
        onUndo={undoPromptEdit}
        onRedo={redoPromptEdit}
        onSpecialKey={(input, key) => (
          onSpecialKey?.(input, key, draft) ||
          fileMentions.handleSpecialKey(input, key) ||
          pickers.handleSpecialKey(input, key)
        )}
      />
    </>
  );
});

export function shouldDisablePromptInputSubmit({
  keyboardDisabled,
  pickerVisible,
  submitDisabled,
}: {
  keyboardDisabled: boolean;
  pickerVisible: boolean;
  submitDisabled: boolean;
}): boolean {
  return keyboardDisabled || (submitDisabled && !pickerVisible);
}

function resolvePromptPlaceholder(snapshot: ControlPlaneSessionStoreSnapshot): string {
  if (snapshot.loading) {
    return 'Loading session...';
  }

  if (snapshot.pendingApproval) {
    return 'Waiting for approval';
  }

  if (snapshot.running) {
    return 'Queue a follow-up';
  }

  return 'Type a prompt';
}
