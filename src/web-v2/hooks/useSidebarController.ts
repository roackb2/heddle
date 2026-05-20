import { useState } from 'react';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { usePanelRef } from 'react-resizable-panels';

// useSidebarController owns the interactive control state for the left sidebar panel.
export function useSidebarController() {
  const sidebarPanelRef = usePanelRef();
  const [isCollapsed, setIsCollapsed] = useState(false);

  function toggleSidebar() {
    const panel = sidebarPanelRef.current;

    if (!panel) {
      return;
    }

    if (panel.isCollapsed()) {
      panel.expand();
      setIsCollapsed(false);
      return;
    }

    panel.collapse();
    setIsCollapsed(true);
  }

  function syncCollapsedState() {
    setIsCollapsed(sidebarPanelRef.current?.isCollapsed() ?? false);
  }

  return {
    isCollapsed,
    sidebarPanelRef,
    syncCollapsedState,
    toggleSidebar,
    resolveToggleIcon() {
      if (!isCollapsed) {
        return PanelLeftClose;
      }

      return PanelLeftOpen;
    },
  };
}
