import { useMemo } from 'react';
import { formatApiError } from '@web/api/errors';
import { useErrorToasts } from './useErrorToasts';

type UseControlPlaneErrorToastsArgs = {
  stateError: unknown;
  sessionError: unknown;
};

export function useControlPlaneErrorToasts({
  stateError,
  sessionError,
}: UseControlPlaneErrorToastsArgs) {
  const sources = useMemo(() => [
    {
      key: 'control-plane-state',
      title: 'Failed to load control plane state',
      error: stateError,
      formatError: formatApiError,
    },
    {
      key: 'session-detail',
      title: 'Failed to load session detail',
      error: sessionError,
      formatError: formatApiError,
    },
  ], [sessionError, stateError]);

  useErrorToasts(sources);
}
