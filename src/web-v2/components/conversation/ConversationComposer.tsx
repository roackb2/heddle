import { useCallback, useRef, useState } from 'react';
import { ArrowUp } from 'lucide-react';
import type { ControlPlaneModelOptions } from '@web/api/client';
import { Button } from '@web/components/ui/button';
import { Textarea } from '@web/components/ui/textarea';
import type { ControlPlaneReasoningEffortSelection } from '@web/hooks/sessions/useControlPlaneSessionDetail';
import { useI18n } from '@web/i18n';
import { appendUploadedImagePaths } from '@web/hooks/conversation/composerImagePrompt';
import { useComposerImageAttachments } from '@web/hooks/conversation/useComposerImageAttachments';
import { useComposerImageDrop } from '@web/hooks/conversation/useComposerImageDrop';
import { useComposerTextareaAutosize } from '@web/hooks/conversation/useComposerTextareaAutosize';
import { useComposerImageUploadToasts } from '@web/hooks/conversation/useComposerImageUploadToasts';
import { useFileMentionAutocomplete } from '@web/hooks/conversation/useFileMentionAutocomplete';
import { usePromptHistoryNavigation } from '@web/hooks/conversation/usePromptHistoryNavigation';
import {
  ComposerImageUploadControls,
  type ComposerImageUploadControlsHandle,
} from './ComposerImageUploadControls';
import { ComposerContextMenu } from './ComposerContextMenu';
import {
  ComposerExecutionMenu,
  type ComposerReasoningEffortSelection,
} from './ComposerExecutionMenu';
import { FileMentionMenu } from './FileMentionMenu';
import type { SessionDriftLevel } from './SessionDriftControl';

// ConversationComposer owns the prompt draft and submit lifecycle. Context,
// execution settings, file mentions, and textarea sizing live in focused peers.
export function ConversationComposer({
  sessionId,
  workspaceId,
  disabled,
  driftEnabled,
  driftLevel,
  model,
  modelOptions,
  reasoningEffort,
  settingsUpdating,
  settingsError,
  submitting,
  running,
  cancelling,
  onSubmitPrompt,
  onCancelRun,
  onUpdateDriftEnabled,
  onUpdateModel,
  onUpdateReasoningEffort,
}: {
  sessionId?: string;
  workspaceId?: string;
  disabled?: boolean;
  driftEnabled?: boolean;
  driftLevel?: SessionDriftLevel;
  model?: string;
  modelOptions?: ControlPlaneModelOptions;
  reasoningEffort?: ComposerReasoningEffortSelection;
  settingsUpdating?: boolean;
  settingsError?: string;
  submitting?: boolean;
  running?: boolean;
  cancelling?: boolean;
  onSubmitPrompt: (prompt: string) => Promise<void>;
  onCancelRun?: () => Promise<void>;
  onUpdateDriftEnabled?: (enabled: boolean) => Promise<void>;
  onUpdateModel?: (model: string) => Promise<void>;
  onUpdateReasoningEffort?: (value: ControlPlaneReasoningEffortSelection) => Promise<void>;
}) {
  const { t } = useI18n();
  const imageUploadControlsRef = useRef<ComposerImageUploadControlsHandle>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState('');
  const {
    attachments: imageUploadAttachments,
    clearUploadedAttachments,
    error: imageUploadError,
    isUploading: imageUploading,
    removeAttachment: removeImageAttachment,
    uploadedPaths: uploadedImagePaths,
    uploadImages,
  } = useComposerImageAttachments({ workspaceId, sessionId });
  const turnActive = Boolean(submitting || running || cancelling);
  const hasSubmitContent = Boolean(draft.trim() || uploadedImagePaths.length);
  const inputDisabled = Boolean(disabled || submitting || cancelling);
  const controlsDisabled = Boolean(disabled || submitting || cancelling);
  const sendDisabled = disabled
    || submitting
    || cancelling
    || imageUploading
    || !hasSubmitContent;
  const effectiveDriftEnabled = driftEnabled ?? false;
  const effectiveDriftLevel = driftLevel ?? 'unknown';
  const effectiveReasoningEffort = reasoningEffort ?? 'medium';
  const imageUploadDisabled = controlsDisabled || imageUploading || !workspaceId || !sessionId;
  const handleUploadImages = useCallback((files: FileList | File[]) => {
    void uploadImages(files);
  }, [uploadImages]);
  const imageDrop = useComposerImageDrop({
    disabled: imageUploadDisabled,
    onUploadImages: handleUploadImages,
  });
  useComposerImageUploadToasts(imageUploadError);

  const promptHistory = usePromptHistoryNavigation({
    value: draft,
    onValueChange: setDraft,
    textareaRef,
    disabled: inputDisabled,
  });
  const { recordPrompt } = promptHistory;
  const handleSubmit = useCallback(async () => {
    const prompt = appendUploadedImagePaths(draft.trim(), uploadedImagePaths);
    if (!prompt || sendDisabled) {
      return;
    }

    await onSubmitPrompt(prompt);
    recordPrompt(prompt);
    setDraft('');
    clearUploadedAttachments();
  }, [clearUploadedAttachments, draft, onSubmitPrompt, recordPrompt, sendDisabled, uploadedImagePaths]);
  const fileMentions = useFileMentionAutocomplete({
    workspaceId,
    value: draft,
    onValueChange: setDraft,
    textareaRef,
    disabled: inputDisabled,
    onSubmit: handleSubmit,
  });
  useComposerTextareaAutosize(textareaRef, draft);

  return (
    <form
      className="v2-composer-shell"
      data-drag-active={imageDrop.dragActive ? 'true' : undefined}
      {...imageDrop.dropZoneProps}
      onSubmit={(event) => {
        event.preventDefault();
        void handleSubmit();
      }}
    >
      <Textarea
        ref={fileMentions.textareaRef}
        aria-label={t('composer.promptAriaLabel')}
        aria-activedescendant={fileMentions.textareaProps['aria-activedescendant']}
        aria-autocomplete={fileMentions.textareaProps['aria-autocomplete']}
        aria-controls={fileMentions.textareaProps['aria-controls']}
        aria-expanded={fileMentions.textareaProps['aria-expanded']}
        className="v2-composer-textarea"
        disabled={inputDisabled}
        autoCapitalize="sentences"
        autoComplete="off"
        autoCorrect="on"
        enterKeyHint="send"
        inputMode="text"
        placeholder={t('composer.placeholder')}
        rows={1}
        spellCheck
        value={draft}
        onChange={fileMentions.textareaProps.onChange}
        onClick={fileMentions.textareaProps.onClick}
        onKeyDown={(event) => {
          if (fileMentions.handleKeyDown(event)) {
            return;
          }

          promptHistory.handleKeyDown(event);
        }}
        onSelect={fileMentions.textareaProps.onSelect}
      />
      {fileMentions.isOpen ? <FileMentionMenu {...fileMentions.menuProps} /> : null}
      <ComposerImageUploadControls
        ref={imageUploadControlsRef}
        attachments={imageUploadAttachments}
        disabled={imageUploadDisabled}
        onRemoveAttachment={removeImageAttachment}
        onUploadImages={handleUploadImages}
      />
      <div className="v2-composer-toolbar">
        <ComposerContextMenu
          disabled={controlsDisabled}
          driftEnabled={effectiveDriftEnabled}
          driftLevel={effectiveDriftLevel}
          settingsUpdating={settingsUpdating}
          uploadDisabled={imageUploadDisabled}
          onUploadImagesClick={() => imageUploadControlsRef.current?.openFilePicker()}
          onUpdateDriftEnabled={onUpdateDriftEnabled}
        />
        <div className="v2-composer-toolbar-controls">
          <ComposerExecutionMenu
            disabled={controlsDisabled}
            settingsUpdating={settingsUpdating}
            model={model}
            modelOptions={modelOptions}
            reasoningEffort={effectiveReasoningEffort}
            onUpdateModel={onUpdateModel}
            onUpdateReasoningEffort={onUpdateReasoningEffort}
          />
          {turnActive && !hasSubmitContent ? (
            <Button
              type="button"
              size="none"
              className="v2-composer-send-button size-8 min-w-8 max-w-8 rounded-full p-0"
              data-state="stopping"
              aria-label={t('composer.stop')}
              disabled={cancelling || !onCancelRun}
              onClick={() => {
                void onCancelRun?.();
              }}
            >
              <span aria-hidden="true" className="v2-composer-stop-glyph" />
            </Button>
          ) : (
            <Button
              type="submit"
              size="none"
              className="v2-composer-send-button size-8 min-w-8 max-w-8 rounded-full p-0"
              aria-label={running ? 'Queue follow-up' : t('composer.send')}
              disabled={sendDisabled}
            >
              <ArrowUp aria-hidden="true" data-icon="inline-start" />
            </Button>
          )}
        </div>
      </div>
      {settingsError ? <p className="v2-composer-error text-pretty">{settingsError}</p> : null}
    </form>
  );
}
