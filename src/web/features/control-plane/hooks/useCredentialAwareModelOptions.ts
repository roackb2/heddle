import { useMemo } from 'react';
import type { ModelOptions } from '../../../lib/api.js';
// Boundary note: this hook temporarily reuses browser-safe model catalog/policy logic. Desired
// shape: model availability and reasoning-effort view models should come from the control-plane API
// or a dedicated browser-safe interaction-surface package, not direct core service imports.
import { ModelCatalogService, ModelPolicyService } from '../../../../core/llm/models/index.js';
import type { ControlPlaneState } from '../../../lib/api.js';

export type CredentialAwareModelGroup = {
  label: string;
  models: string[];
  resolvedOptions: Array<{
    id: string;
    disabled: boolean;
    disabledReason?: string;
  }>;
};

export type ReasoningEffortOption = {
  id: 'default' | 'low' | 'medium' | 'high' | 'ultrahigh';
  disabled: boolean;
  label: string;
};

export function useCredentialAwareModelOptions(args: {
  modelOptions: ModelOptions | null;
  auth?: ControlPlaneState['auth'];
  selectedModel?: string;
  selectedReasoningEffort?: 'low' | 'medium' | 'high' | 'ultrahigh';
  runActive: boolean;
}) {
  const openAiOauthActive = args.auth?.openai?.type === 'oauth';

  const groups = useMemo<CredentialAwareModelGroup[]>(() => {
    if (!args.modelOptions) {
      return [];
    }

    return args.modelOptions.groups.map((group) => ({
      ...group,
      resolvedOptions: (group.options ?? group.models.map((model) => ({ id: model, disabled: false }))).map((option) => {
        const disabled = openAiOauthActive && option.id.startsWith('gpt-')
          ? !ModelCatalogService.isOpenAiAccountSignInModel(option.id)
          : false;
        return {
          id: option.id,
          disabled,
          disabledReason: disabled ? 'Not supported' : option.disabledReason,
        };
      }),
    }));
  }, [args.modelOptions, openAiOauthActive]);

  const selectedModelOption = useMemo(() => (
    groups.flatMap((group) => group.resolvedOptions).find((option) => option.id === args.selectedModel)
  ), [groups, args.selectedModel]);

  const reasoningEffortOptions = useMemo<ReasoningEffortOption[]>(() => {
    const supported = args.selectedModel ? ModelPolicyService.supportsReasoningEffort(args.selectedModel) : false;
    const defaultEffort = args.selectedModel ? ModelPolicyService.resolveDefaultReasoningEffort(args.selectedModel) : undefined;
    return [
      { id: 'default', disabled: !supported, label: defaultEffort ? `Default (${defaultEffort})` : 'Default' },
      { id: 'low', disabled: !supported, label: 'Low' },
      { id: 'medium', disabled: !supported, label: 'Medium' },
      { id: 'high', disabled: !supported, label: 'High' },
      { id: 'ultrahigh', disabled: true, label: 'Ultra high (reserved)' },
    ];
  }, [args.selectedModel]);

  const selectedReasoningEffortOption = useMemo(() => (
    reasoningEffortOptions.find((option) => option.id === (args.selectedReasoningEffort ?? 'default'))
  ), [reasoningEffortOptions, args.selectedReasoningEffort]);

  return {
    groups,
    selectedModelOption,
    reasoningEffortOptions,
    selectedReasoningEffortOption,
    selectorDisabled: args.runActive || !args.modelOptions,
  };
}
