interface SidebarContentRegionProps {
  ariaLabel: string;
}

// SidebarContentRegion reserves the future session-list area without inventing
// sample sessions or extra product surfaces.
export function SidebarContentRegion({ ariaLabel }: SidebarContentRegionProps) {
  return (
    <div
      className="min-h-0 flex-1 border-t border-border/70 bg-card"
      aria-label={ariaLabel}
    />
  );
}
