import { useCallback, useMemo, type Dispatch, type SetStateAction } from 'react';
import {
  trpcReact,
  type ControlPlaneModelOptions,
  type ControlPlaneSessionDetail,
  type ControlPlaneSessionSettingsInput,
} from '@web/api/client';

export type ControlPlaneReasoningEffort = NonNullable<Exclude<ControlPlaneSessionSettingsInput['reasoningEffort'], null | undefined>>;
export type ControlPlaneReasoningEffortSelection = ControlPlaneReasoningEffort | 'default';

type UseControlPlaneSessionSettingsArgs = {
  sessionId?: string;
  setSession: Dispatch<SetStateAction<ControlPlaneSessionDetail>>;
  setError: Dispatch<SetStateAction<string | undefined>>;
};

export type ControlPlaneSessionSettingsState = {
  modelOptions?: ControlPlaneModelOptions;
  settingsUpdating: boolean;
  settingsError?: string;
  updateModel: (model: string) => Promise<void>;
  updateReasoningEffort: (value: ControlPlaneReasoningEffortSelection) => Promise<void>;
};

// Owns web-v2 session setting mutations. The composer renders controls, while
// this hook keeps API writes and cache invalidation at the session workflow layer.
export function useControlPlaneSessionSettings({
  sessionId,
  setSession,
  setError,
}: UseControlPlaneSessionSettingsArgs): ControlPlaneSessionSettingsState {
  const utils = trpcReact.useUtils();
  const modelOptionsQuery = trpcReact.controlPlane.modelOptions.useQuery();
  const updateSettingsMutation = trpcReact.controlPlane.sessionSettingsUpdate.useMutation();

  const updateSettings = useCallback(async (settings: Omit<ControlPlaneSessionSettingsInput, 'id'>) => {
    if (!sessionId) {
      return;
    }

    try {
      const updated = await updateSettingsMutation.mutateAsync({
        id: sessionId,
        ...settings,
      });
      setSession(updated);
      setError(undefined);
      await Promise.all([
        utils.controlPlane.state.invalidate(),
        utils.controlPlane.session.invalidate({ id: sessionId }),
      ]);
    } catch (settingsError) {
      setError(settingsError instanceof Error ? settingsError.message : String(settingsError));
    }
  }, [
    sessionId,
    setError,
    setSession,
    updateSettingsMutation,
    utils.controlPlane.session,
    utils.controlPlane.state,
  ]);

  return useMemo(() => ({
    modelOptions: modelOptionsQuery.data,
    settingsUpdating: updateSettingsMutation.isPending,
    settingsError: updateSettingsMutation.error instanceof Error ? updateSettingsMutation.error.message : undefined,
    updateModel: (model: string) => updateSettings({ model }),
    updateReasoningEffort: (value: ControlPlaneReasoningEffortSelection) => updateSettings({
      reasoningEffort: value === 'default' ? null : value,
    }),
  }), [
    modelOptionsQuery.data,
    updateSettings,
    updateSettingsMutation.error,
    updateSettingsMutation.isPending,
  ]);
}
