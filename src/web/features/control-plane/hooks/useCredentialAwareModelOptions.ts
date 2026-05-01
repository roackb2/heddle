import { useMemo } from 'react';
import type { ModelOptions } from '../../../lib/api.js';
import { isOpenAiAccountSignInModel } from '../../../../core/llm/openai-models.js';
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

export function useCredentialAwareModelOptions(args: {
  modelOptions: ModelOptions | null;
  auth?: ControlPlaneState['auth'];
  selectedModel?: string;
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
          ? !isOpenAiAccountSignInModel(option.id)
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

  return {
    groups,
    selectedModelOption,
    selectorDisabled: args.runActive || !args.modelOptions,
  };
}
