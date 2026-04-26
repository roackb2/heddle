import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { InspectorTab } from '../hooks/useSessionsScreenState';

type ControlPlaneUiState = {
  inspectorTab: InspectorTab;
  setInspectorTab: (tab: InspectorTab) => void;
};

export const useControlPlaneUiStore = create<ControlPlaneUiState>()(
  persist(
    (set) => ({
      inspectorTab: 'review',
      setInspectorTab: (inspectorTab) => set({ inspectorTab }),
    }),
    {
      name: 'heddle-control-plane-ui',
      partialize: (state) => ({ inspectorTab: state.inspectorTab }),
    },
  ),
);
