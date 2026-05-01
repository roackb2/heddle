import { Button } from '../../../components/ui/button.js';
import { Popover, PopoverContent, PopoverTrigger } from '../../../components/ui/popover.js';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../../components/ui/tooltip.js';
import { OPENAI_OAUTH_MODE_DESCRIPTION } from '../../../../core/llm/model-policy.js';
import type { CredentialAwareModelGroup } from '../hooks/useCredentialAwareModelOptions.js';
import { className } from '../utils.js';

type ModelSelectorPopoverProps = {
  selectedModel: string;
  selectedModelUnsupported: boolean;
  disabled: boolean;
  groups: CredentialAwareModelGroup[];
  runActive: boolean;
  modelOptionsError?: string;
  onSelectModel: (model: string) => void;
};

export function ModelSelectorPopover({
  selectedModel,
  selectedModelUnsupported,
  disabled,
  groups,
  runActive,
  modelOptionsError,
  onSelectModel,
}: ModelSelectorPopoverProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={className('model-select-trigger', selectedModelUnsupported && 'unsupported')}
          disabled={disabled}
          title={modelOptionsError ? 'Model options unavailable. Restart the Heddle daemon if this route was just added.' : undefined}
        >
          <span>{selectedModel || 'loading models'}</span>
          {selectedModelUnsupported ? <span className="model-select-trigger-reason">Not supported</span> : null}
        </Button>
      </PopoverTrigger>
      {groups.length > 0 ?
        <PopoverContent className="model-select-menu p-2" align="end">
          <div role="listbox" aria-label="Model options">
            {groups.map((group) => (
              <div className="model-select-group" key={group.label}>
                <div className="model-select-group-label">{group.label}</div>
                {group.resolvedOptions.map((option) => {
                  const optionButton = (
                    <button
                      key={option.id}
                      className={className('model-select-option', option.id === selectedModel && 'selected', option.disabled && 'disabled')}
                      type="button"
                      role="option"
                      aria-selected={option.id === selectedModel}
                      aria-disabled={option.disabled}
                      disabled={option.disabled || runActive}
                      onClick={() => {
                        if (!option.disabled) {
                          onSelectModel(option.id);
                        }
                      }}
                    >
                      <span>{option.id === selectedModel ? '✓ ' : ''}{option.id}</span>
                      {option.disabled ? <span className="model-select-option-reason">Not supported</span> : null}
                    </button>
                  );

                  return option.disabled ? (
                    <TooltipProvider key={option.id}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="model-select-option-wrapper">{optionButton}</span>
                        </TooltipTrigger>
                        <TooltipContent>{OPENAI_OAUTH_MODE_DESCRIPTION}</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  ) : optionButton;
                })}
              </div>
            ))}
          </div>
        </PopoverContent>
      : null}
    </Popover>
  );
}
