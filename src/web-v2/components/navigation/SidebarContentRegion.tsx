interface SidebarContentRegionProps {
  ariaLabel: string;
}

// SidebarContentRegion reserves the future session-list area without inventing
// sample sessions or extra product surfaces.
export function SidebarContentRegion({ ariaLabel }: SidebarContentRegionProps) {
  return (
    <div
      className="v2-panel-divider v2-panel-surface min-h-0 flex-1 border-t"
      aria-label={ariaLabel}
    />
  );
}
