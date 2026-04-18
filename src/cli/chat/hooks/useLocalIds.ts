import { useCallback, useRef } from 'react';

export function useLocalIds() {
  const nextIdRef = useRef(0);

  return useCallback(() => `ui-${Date.now()}-${nextIdRef.current++}`, []);
}
