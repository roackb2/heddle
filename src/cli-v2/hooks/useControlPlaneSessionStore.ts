import { useSyncExternalStore } from 'react';
import type {
  ControlPlaneSessionStore,
  ControlPlaneSessionStoreSnapshot,
} from '../state/control-plane-session-store.js';

export function useControlPlaneSessionStore(store: ControlPlaneSessionStore): ControlPlaneSessionStoreSnapshot {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
