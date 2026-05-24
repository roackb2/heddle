import { useCallback, useRef, useState } from 'react';
import { ArrowUp } from 'lucide-react';
import type { ControlPlaneModelOptions } from '@web/api/client';
import { Button } from '@web/components/ui/button';
import { Textarea } from '@web/components/ui/textarea';
import type { ControlPlaneReasoningEffortSelection } from '@web/hooks/sessions/useControlPlaneSessionDetail';
import { useI18n } from '@web/i18n';
import { useComposerTextareaAutosize } from '@web/hooks/conversation/useComposerTextareaAutosize';
import { useFileMentionAutocomplete } from '@web/hooks/conversation/useFileMentionAutocomplete';
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
  disabled,
  driftEnabled,
  driftLevel,
  model,
  modelOptions,
  reasoningEffort,
  settingsUpdating,
  settingsError,
  submitting,
  onSubmitPrompt,
  onUpdateDriftEnabled,
  onUpdateModel,
  onUpdateReasoningEffort,
}: {
  disabled?: boolean;
  driftEnabled?: boolean;
  driftLevel?: SessionDriftLevel;
  model?: string;
  modelOptions?: ControlPlaneModelOptions;
  reasoningEffort?: ComposerReasoningEffortSelection;
  settingsUpdating?: boolean;
  settingsError?: string;
  submitting?: boolean;
  onSubmitPrompt: (prompt: string) => Promise<void>;
  onUpdateDriftEnabled?: (enabled: boolean) => Promise<void>;
  onUpdateModel?: (model: string) => Promise<void>;
  onUpdateReasoningEffort?: (value: ControlPlaneReasoningEffortSelection) => Promise<void>;
}) {
  const { t } = useI18n();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState('');
  const sendDisabled = disabled || submitting || !draft.trim();
  const effectiveDriftEnabled = driftEnabled ?? false;
  const effectiveDriftLevel = driftLevel ?? 'unknown';
  const effectiveReasoningEffort = reasoningEffort ?? 'medium';

  const handleSubmit = useCallback(async () => {
    const prompt = draft.trim();
    if (!prompt || sendDisabled) {
      return;
    }

    setDraft('');
    await onSubmitPrompt(prompt);
  }, [draft, onSubmitPrompt, sendDisabled]);
  const fileMentions = useFileMentionAutocomplete({
    value: draft,
    onValueChange: setDraft,
    textareaRef,
    disabled: disabled || submitting,
    onSubmit: handleSubmit,
  });
  useComposerTextareaAutosize(textareaRef, draft);

  return (
    <form
      className="v2-composer-shell"
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
        disabled={disabled || submitting}
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
        onKeyDown={fileMentions.textareaProps.onKeyDown}
        onSelect={fileMentions.textareaProps.onSelect}
      />
      {fileMentions.isOpen ? <FileMentionMenu {...fileMentions.menuProps} /> : null}
      <div className="v2-composer-toolbar">
        <ComposerContextMenu
          disabled={disabled}
          driftEnabled={effectiveDriftEnabled}
          driftLevel={effectiveDriftLevel}
          settingsUpdating={settingsUpdating}
          onUpdateDriftEnabled={onUpdateDriftEnabled}
        />
        <div className="v2-composer-toolbar-controls">
          <ComposerExecutionMenu
            disabled={disabled}
            settingsUpdating={settingsUpdating}
            model={model}
            modelOptions={modelOptions}
            reasoningEffort={effectiveReasoningEffort}
            onUpdateModel={onUpdateModel}
            onUpdateReasoningEffort={onUpdateReasoningEffort}
          />
          <Button
            type="submit"
            size="none"
            className="v2-composer-send-button"
            aria-label={t('composer.send')}
            disabled={sendDisabled}
          >
            <ArrowUp aria-hidden="true" data-icon="inline-start" />
          </Button>
        </div>
      </div>
      {settingsError ? <p className="v2-composer-error text-pretty">{settingsError}</p> : null}
    </form>
  );
}
