import { useEffect, useState } from 'react';
import {
  fetchModelOptions,
  type ControlPlaneState,
  type ModelOptions,
} from '../../../../lib/api';
import { useCredentialAwareModelOptions } from '../useCredentialAwareModelOptions.js';

export function useSessionModelOptions({
  auth,
  selectedModel,
  runActive,
}: {
  auth: ControlPlaneState['auth'];
  selectedModel: string;
  runActive: boolean;
}) {
  const [modelOptions, setModelOptions] = useState<ModelOptions | null>(null);
  const [modelOptionsError, setModelOptionsError] = useState<string | undefined>();
  const {
    groups: modelOptionGroups,
    selectedModelOption,
    selectorDisabled: modelSelectorDisabled,
  } = useCredentialAwareModelOptions({
    modelOptions,
    auth,
    selectedModel,
    runActive,
  });

  useEffect(() => {
    let cancelled = false;
    void fetchModelOptions().then((options) => {
      if (!cancelled) {
        setModelOptions(options);
        setModelOptionsError(undefined);
      }
    }).catch((error) => {
      if (!cancelled) {
        setModelOptions(null);
        setModelOptionsError(error instanceof Error ? error.message : String(error));
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return {
    modelOptions,
    modelOptionsError,
    modelOptionGroups,
    selectedModelOption,
    modelSelectorDisabled,
  };
}
