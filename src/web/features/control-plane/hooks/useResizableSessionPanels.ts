import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';

const PANEL_WIDTH_STORAGE_KEY = 'heddle.controlPlane.sessionPanelWidths';
const PANEL_HANDLE_WIDTH = 12;
const MAIN_PANEL_MIN_WIDTH = 420;
const LEFT_PANEL_MIN_WIDTH = 220;
const LEFT_PANEL_MAX_WIDTH = 520;
const RIGHT_PANEL_MIN_WIDTH = 280;
const RIGHT_PANEL_MAX_WIDTH = 620;

type PanelWidths = {
  left: number;
  right: number;
};

export function useResizableSessionPanels() {
  const shellRef = useRef<HTMLElement>(null);
  const [panelWidths, setPanelWidths] = useState<PanelWidths>(() => readStoredPanelWidths());

  useEffect(() => {
    window.localStorage.setItem(PANEL_WIDTH_STORAGE_KEY, JSON.stringify(panelWidths));
  }, [panelWidths]);

  const workspaceStyle = {
    '--session-sidebar-width': `${panelWidths.left}px`,
    '--session-side-width': `${panelWidths.right}px`,
  } as CSSProperties;

  const startPanelResize = (edge: 'left' | 'right', event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const shellWidth = shellRef.current?.getBoundingClientRect().width;
    if (!shellWidth) {
      return;
    }

    const startX = event.clientX;
    const startWidths = panelWidths;
    const maxLeft = Math.min(LEFT_PANEL_MAX_WIDTH, shellWidth - startWidths.right - MAIN_PANEL_MIN_WIDTH - PANEL_HANDLE_WIDTH);
    const maxRight = Math.min(RIGHT_PANEL_MAX_WIDTH, shellWidth - startWidths.left - MAIN_PANEL_MIN_WIDTH - PANEL_HANDLE_WIDTH);

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const delta = moveEvent.clientX - startX;
      setPanelWidths({
        left:
          edge === 'left' ?
            clamp(startWidths.left + delta, LEFT_PANEL_MIN_WIDTH, maxLeft)
          : startWidths.left,
        right:
          edge === 'right' ?
            clamp(startWidths.right - delta, RIGHT_PANEL_MIN_WIDTH, maxRight)
          : startWidths.right,
      });
    };

    const handlePointerUp = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp, { once: true });
  };

  return {
    shellRef,
    workspaceStyle,
    startPanelResize,
  };
}

function readStoredPanelWidths(): PanelWidths {
  try {
    const stored = window.localStorage.getItem(PANEL_WIDTH_STORAGE_KEY);
    if (!stored) {
      return { left: 288, right: 344 };
    }

    const parsed = JSON.parse(stored) as Partial<PanelWidths>;
    return {
      left: clamp(typeof parsed.left === 'number' ? parsed.left : 288, LEFT_PANEL_MIN_WIDTH, LEFT_PANEL_MAX_WIDTH),
      right: clamp(typeof parsed.right === 'number' ? parsed.right : 344, RIGHT_PANEL_MIN_WIDTH, RIGHT_PANEL_MAX_WIDTH),
    };
  } catch {
    return { left: 288, right: 344 };
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}
